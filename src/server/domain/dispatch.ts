import { and, inArray, notInArray, sql } from 'drizzle-orm'
import type { Run } from '../agent/trace'
import { db, schema } from '../db'
import { type LatLng, travelMatrix } from '../integrations/routing'
import { publish } from '../lib/bus'
import { enqueue } from '../lib/queue'
import { addDays, dayOf, MIN, zoned } from '../lib/time'
import { type OptJob, type OptTech, optimise } from './optimizer'

type JobRow = typeof schema.jobs.$inferSelect
type TechRow = typeof schema.technicians.$inferSelect

export type ReplanResult = {
  days: string[]
  scheduled: number
  unassigned: number[]
  moved: Array<{ jobId: number; from: string | null; to: string | null; techChanged: boolean }>
  travelMin: number
  source: 'ors' | 'estimate'
  ms: number
}

/**
 * Re-plan the whole fleet for `days` days starting today (company time zone).
 * Loads every open job, builds one drive-time matrix, runs the optimiser day by day
 * (leftovers roll to the next day), then writes the plan in a single transaction —
 * the deferred exclusion constraint guarantees no technician is double-booked even mid-reshuffle.
 */
export async function replan(opts: { reason: string; days?: number; run?: Run | null; now?: Date } = { reason: 'manual' }): Promise<ReplanResult> {
  const t0 = Date.now()
  const now = opts.now ?? new Date()
  const today = dayOf(now)
  const days = Array.from({ length: opts.days ?? 3 }, (_, i) => addDays(today, i))
  const horizonEnd = zoned(addDays(today, days.length), '00:00')

  const techs = await db.select().from(schema.technicians).where(sql`${schema.technicians.active}`)
  const open = await db
    .select({ job: schema.jobs, lat: schema.customers.lat, lng: schema.customers.lng })
    .from(schema.jobs)
    .innerJoin(schema.customers, sql`${schema.customers.id} = ${schema.jobs.customerId}`)
    .where(and(notInArray(schema.jobs.status, ['done', 'cancelled']), sql`${schema.jobs.windowStart} < ${horizonEnd}`))
  const doneToday = await db
    .select({ techId: schema.jobs.technicianId, end: schema.jobs.completedAt, lat: schema.customers.lat, lng: schema.customers.lng })
    .from(schema.jobs)
    .innerJoin(schema.customers, sql`${schema.customers.id} = ${schema.jobs.customerId}`)
    .where(and(sql`${schema.jobs.status} = 'done'`, sql`${schema.jobs.completedAt} >= ${zoned(today, '00:00')}`))

  // --- nodes for the travel matrix: tech start points, then job locations ---
  const points: LatLng[] = []
  const techNode = new Map<number, number>()
  for (const t of techs) {
    const lastDone = doneToday.filter((d) => d.techId === t.id).sort((a, b) => +(b.end ?? 0) - +(a.end ?? 0))[0]
    const fresh = t.liveAt && now.getTime() - t.liveAt.getTime() < 30 * MIN && t.liveLat != null
    const p = fresh ? { lat: t.liveLat!, lng: t.liveLng! } : lastDone?.lat != null ? { lat: lastDone.lat, lng: lastDone.lng! } : { lat: t.homeLat, lng: t.homeLng }
    techNode.set(t.id, points.push(p) - 1)
  }
  const homeNode = new Map<number, number>()
  for (const t of techs) homeNode.set(t.id, points.push({ lat: t.homeLat, lng: t.homeLng }) - 1)
  const jobNode = new Map<number, number>()
  for (const r of open) jobNode.set(r.job.id, points.push({ lat: r.lat ?? 39.74, lng: r.lng ?? -104.99 }) - 1)
  const { minutes, source } = await travelMatrix(points)
  const travel = (a: number, b: number) => minutes[a]?.[b] ?? 30

  const placed = new Map<number, { techId: number; start: Date; end: Date; seq: number }>()
  let travelTotal = 0
  let remaining = open.map((r) => r.job)

  for (const [di, day] of days.entries()) {
    const dayStart = zoned(day, '00:00')
    const toMin = (d: Date) => Math.round((d.getTime() - dayStart.getTime()) / MIN)
    const nowMin = di === 0 ? toMin(now) + 10 : -Infinity

    const optTechs: OptTech[] = techs.map((t) => {
      const ws = toMin(zoned(day, t.workStart))
      const we = toMin(zoned(day, t.workEnd))
      return {
        id: t.id,
        skills: t.skills,
        senior: t.level === 'senior',
        startNode: di === 0 ? techNode.get(t.id)! : homeNode.get(t.id)!,
        startMin: Math.max(ws, nowMin),
        endMin: we,
      }
    })

    const optJobs: OptJob[] = []
    for (const j of remaining) {
      const inProgress = (j.status === 'en_route' || j.status === 'on_site') && j.technicianId && j.scheduledStart
      if (inProgress) {
        if (dayOf(j.scheduledStart!) !== day) continue
        optJobs.push(toOpt(j, jobNode.get(j.id)!, 0, 0, { pinnedTechId: j.technicianId!, pinnedStart: toMin(j.scheduledStart!) }))
        continue
      }
      const ws = Math.max(toMin(j.windowStart), nowMin)
      const we = toMin(j.windowEnd) - j.durationMin
      if (we < ws || ws > 24 * 60) continue // window does not touch this day
      optJobs.push(toOpt(j, jobNode.get(j.id)!, ws, we, j.lockedTech && j.technicianId ? { lockedTechId: j.technicianId } : {}))
    }

    const plan = optimise(optTechs, optJobs, travel, { maxMs: 600 })
    travelTotal += plan.travelMin
    for (const [techId, stops] of Object.entries(plan.routes)) {
      stops.forEach((s, i) => {
        placed.set(s.jobId, {
          techId: Number(techId),
          start: new Date(dayStart.getTime() + s.start * MIN),
          end: new Date(dayStart.getTime() + s.end * MIN),
          seq: i + 1,
        })
      })
    }
    remaining = remaining.filter((j) => !placed.has(j.id))
  }

  // --- persist atomically ---
  const before = new Map(open.map((r) => [r.job.id, r.job]))
  const moved: ReplanResult['moved'] = []
  await db.transaction(async (tx) => {
    for (const [jobId, p] of placed) {
      const old = before.get(jobId)!
      const keepStatus = old.status === 'en_route' || old.status === 'on_site'
      await tx
        .update(schema.jobs)
        .set({
          technicianId: p.techId,
          scheduledStart: p.start,
          scheduledEnd: p.end,
          sequence: p.seq,
          etaAt: p.start,
          status: keepStatus ? old.status : 'scheduled',
        })
        .where(sql`${schema.jobs.id} = ${jobId}`)
      const shifted = !old.scheduledStart || Math.abs(old.scheduledStart.getTime() - p.start.getTime()) > 30 * MIN
      const techChanged = old.technicianId !== p.techId
      if (shifted || techChanged) moved.push({ jobId, from: old.scheduledStart?.toISOString() ?? null, to: p.start.toISOString(), techChanged })
    }
    const unplaced = remaining.map((j) => j.id)
    if (unplaced.length) {
      await tx
        .update(schema.jobs)
        .set({ technicianId: null, scheduledStart: null, scheduledEnd: null, sequence: null, etaAt: null, status: 'unassigned' })
        .where(and(inArray(schema.jobs.id, unplaced), notInArray(schema.jobs.status, ['en_route', 'on_site'])))
      for (const id of unplaced) {
        const old = before.get(id)!
        if (old.scheduledStart) moved.push({ jobId: id, from: old.scheduledStart.toISOString(), to: null, techChanged: true })
      }
    }
  })

  const result: ReplanResult = {
    days,
    scheduled: placed.size,
    unassigned: remaining.map((j) => j.id),
    moved,
    travelMin: travelTotal,
    source,
    ms: Date.now() - t0,
  }
  await opts.run?.step(
    'tool',
    'optimiser',
    { reason: opts.reason, jobs: open.length, techs: techs.length, matrix: source },
    { scheduled: result.scheduled, unassigned: result.unassigned.length, moved: moved.length, travelMin: travelTotal },
    result.ms,
  )
  await publish('plan.updated', { reason: opts.reason, scheduled: result.scheduled, unassigned: result.unassigned.length, moved: moved.length, travelMin: travelTotal })

  // side effects after commit: calendar sync + customer notifications for real moves
  for (const id of placed.keys()) await enqueue('calendar.sync', { jobId: id }, { dedupeKey: `cal:${id}:${placed.get(id)!.start.toISOString()}` })
  for (const m of moved) if (m.from) await enqueue('notify.moved', m, { dedupeKey: `moved:${m.jobId}:${m.to ?? 'none'}` })
  return result
}

function toOpt(j: JobRow, node: number, ws: number, we: number, extra: Partial<OptJob>): OptJob {
  return {
    id: j.id,
    node,
    durationMin: j.durationMin,
    skill: j.skill,
    priority: j.priority as 1 | 2 | 3 | 4,
    winStart: ws,
    winEnd: we,
    valueCents: j.estValueCents,
    wantsSenior: j.skill === 'hvac_install' || j.estValueCents >= 100000,
    ...extra,
  }
}

/** Default acceptable window for a new job, by priority. */
export function defaultWindow(priority: number, now = new Date()): { start: Date; end: Date } {
  const today = dayOf(now)
  if (priority === 1) return { start: now, end: zoned(addDays(today, 1), '12:00') }
  if (priority === 2) return { start: now, end: zoned(addDays(today, 1), '19:00') }
  if (priority === 3) return { start: zoned(addDays(today, 1), '08:00'), end: zoned(addDays(today, 4), '17:00') }
  return { start: zoned(addDays(today, 1), '08:00'), end: zoned(addDays(today, 7), '17:00') }
}

export type { JobRow, TechRow }
