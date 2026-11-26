import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { completeJobFromVoiceNote } from '../agent/revenue'
import { afterChange, arrived, onMyWay, runningLate, updateLocation } from '../agent/technician'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { firstName } from '../domain/messaging'
import { publish } from '../lib/bus'
import { dayOf, zoned } from '../lib/time'

/**
 * Field simulator: everything a technician can do from the Telegram app, as buttons in the
 * dashboard, so a demo can run the whole day without phones. Each action calls the same code the
 * Telegram bot calls, so customers get the same texts and the fleet re-plans the same way.
 */
export async function fieldView() {
  const start = zoned(dayOf(new Date()), '00:00')
  const techs = await db.select().from(schema.technicians).orderBy(asc(schema.technicians.name))
  const rows = await db
    .select({ job: schema.jobs, c: schema.customers })
    .from(schema.jobs)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
    .where(or(inArray(schema.jobs.status, ['unassigned', 'scheduled', 'en_route', 'on_site']), and(eq(schema.jobs.status, 'done'), gte(schema.jobs.completedAt, start))))
    .orderBy(asc(schema.jobs.scheduledStart))
  const job = ({ job: j, c }: (typeof rows)[number]) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    priority: j.priority,
    technicianId: j.technicianId,
    start: j.scheduledStart?.toISOString() ?? null,
    end: j.scheduledEnd?.toISOString() ?? null,
    eta: j.etaAt?.toISOString() ?? null,
    windowEnd: j.windowEnd.toISOString(),
    acceptedAt: j.acceptedAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
    customer: { name: c.name, address: c.address, lat: c.lat, lng: c.lng },
  })
  return {
    techs: techs.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      active: t.active,
      telegram: !!t.telegramChatId,
      live: t.liveLat != null && t.liveAt ? { lat: t.liveLat, lng: t.liveLng!, at: t.liveAt.toISOString() } : null,
      home: { lat: t.homeLat, lng: t.homeLng },
      jobs: rows.filter((r) => r.job.technicianId === t.id && r.job.status !== 'unassigned').map(job),
    })),
    unassigned: rows.filter((r) => r.job.status === 'unassigned' || !r.job.technicianId).map(job),
  }
}

export type FieldAction =
  | { action: 'accept'; jobId: number }
  | { action: 'take'; jobId: number }
  | { action: 'omw'; jobId: number }
  | { action: 'arrive'; jobId: number }
  | { action: 'late'; minutes: number }
  | { action: 'note'; jobId: number; text: string }
  | { action: 'done'; jobId: number; text: string }
  | { action: 'drive'; jobId?: number }
  | { action: 'locate'; lat: number; lng: number }
  | { action: 'duty'; active: boolean }

const ownJob = async (techId: number, jobId: number) => {
  const [j] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.technicianId, techId)))
  if (!j) throw new Error('That visit is not on this technician’s route.')
  return j
}

export async function fieldAction(techId: number, a: FieldAction): Promise<{ text: string }> {
  const [tech] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, techId))
  if (!tech) throw new Error('Technician not found')
  const who = firstName(tech.name)
  switch (a.action) {
    case 'accept': {
      await ownJob(techId, a.jobId)
      // accepted visits stay with this tech when the fleet re-plans
      await db.update(schema.jobs).set({ acceptedAt: new Date(), lockedTech: true }).where(eq(schema.jobs.id, a.jobId))
      await publish('job.accepted', { jobId: a.jobId, technicianId: techId, name: tech.name })
      return { text: `${who} accepted visit #${a.jobId}.` }
    }
    case 'take': {
      const [j] = await db
        .update(schema.jobs)
        .set({ technicianId: techId, lockedTech: true, acceptedAt: new Date() })
        .where(and(eq(schema.jobs.id, a.jobId), or(isNull(schema.jobs.technicianId), eq(schema.jobs.status, 'unassigned'))))
        .returning()
      if (!j) throw new Error('Someone else already has that visit.')
      await publish('job.accepted', { jobId: a.jobId, technicianId: techId, name: tech.name })
      const res = await replan({ reason: `${who} took visit #${a.jobId}` })
      const placed = !res.unassigned.includes(a.jobId)
      return { text: placed ? `${who} took visit #${a.jobId}; it's on the route now.` : `${who} claimed #${a.jobId}, but it doesn't fit their day yet.` }
    }
    case 'omw':
      await ownJob(techId, a.jobId)
      return { text: await onMyWay(techId, a.jobId) }
    case 'arrive':
      await ownJob(techId, a.jobId)
      return { text: await arrived(techId, a.jobId) }
    case 'late':
      return { text: await runningLate(techId, a.minutes) }
    case 'note': {
      await ownJob(techId, a.jobId)
      await db.insert(schema.messages).values({ technicianId: techId, jobId: a.jobId, direction: 'in', channel: 'telegram', body: a.text, delivered: true, via: 'test' })
      await publish('tech.note', { technicianId: techId, name: tech.name, jobId: a.jobId, preview: a.text.slice(0, 80) })
      return { text: 'Note added to the visit.' }
    }
    case 'done': {
      await ownJob(techId, a.jobId)
      const res = await completeJobFromVoiceNote(a.jobId, null, a.text)
      afterChange(techId, `job #${a.jobId} completed`)
      return {
        text: `Visit #${a.jobId} closed. Invoice #${res.invoiceId} for $${(res.totalCents / 100).toFixed(2)} ${res.status === 'done' ? 'sent to the customer' : 'waiting for your approval'}.`,
      }
    }
    case 'drive': {
      // one step of a drive toward the visit: a third of the way, or the last stretch when close
      const target = a.jobId
        ? await ownJob(techId, a.jobId)
        : (
            await db
              .select()
              .from(schema.jobs)
              .where(and(eq(schema.jobs.technicianId, techId), inArray(schema.jobs.status, ['en_route', 'scheduled'])))
              .orderBy(asc(schema.jobs.scheduledStart))
              .limit(1)
          )[0]
      if (!target) throw new Error(`${who} has no visit to drive to.`)
      const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, target.customerId))
      if (c.lat == null) throw new Error('That address has no map position.')
      const from = tech.liveLat != null ? { lat: tech.liveLat, lng: tech.liveLng! } : { lat: tech.homeLat, lng: tech.homeLng }
      const km = Math.hypot((c.lat - from.lat) * 111, (c.lng! - from.lng) * 85)
      const f = km < 0.8 ? 1 : 0.34
      await updateLocation(techId, from.lat + (c.lat - from.lat) * f, from.lng + (c.lng! - from.lng) * f)
      return { text: f === 1 ? `${who} pulled up outside ${c.address}.` : `${who} is ${Math.max(0.1, km * (1 - f)).toFixed(1)} km from ${c.name.split(' ')[0]}'s.` }
    }
    case 'locate':
      await updateLocation(techId, a.lat, a.lng)
      return { text: 'Location shared.' }
    case 'duty': {
      await db.update(schema.technicians).set({ active: a.active }).where(eq(schema.technicians.id, techId))
      if (!a.active)
        await db
          .update(schema.jobs)
          .set({ technicianId: null, lockedTech: false, acceptedAt: null })
          .where(and(eq(schema.jobs.technicianId, techId), eq(schema.jobs.status, 'scheduled')))
      const res = await replan({ reason: `${who} ${a.active ? 'back on duty' : 'off duty'}` })
      return { text: `${who} is ${a.active ? 'back on duty' : 'off duty'}. ${res.moved.length} visit(s) re-planned.` }
    }
  }
}
