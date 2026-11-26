import type { Content } from '@google/genai'
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { getSettings } from '../domain/settings'
import { aiEnabled, runTools, type Tool } from '../integrations/gemini'
import { setWeatherOverride } from '../integrations/weather'
import { addDays, dayOf, fmtDayTime, zoned } from '../lib/time'
import { act, registerExecutor } from './policy'
import { Run } from './trace'

/**
 * Ops copilot for the owner: plain-language questions and commands over the live business.
 * Reads are direct; anything that touches customers or the schedule goes through the policy engine.
 */
const tools: Tool[] = [
  {
    name: 'get_schedule',
    description: 'Visits for a day (today by default), grouped by technician, plus unassigned jobs.',
    params: z.object({ day: z.string().optional().describe('YYYY-MM-DD in company time; omit for today') }),
    handler: async (a) => {
      const day = (a.day as string) || dayOf(new Date())
      const rows = await db
        .select({ j: schema.jobs, c: schema.customers.name, t: schema.technicians.name })
        .from(schema.jobs)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
        .leftJoin(schema.technicians, eq(schema.technicians.id, schema.jobs.technicianId))
        .where(inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site', 'unassigned', 'done']))
        .orderBy(asc(schema.jobs.scheduledStart))
      return rows
        .filter((r) => (r.j.scheduledStart ? dayOf(r.j.scheduledStart) === day : r.j.status === 'unassigned'))
        .map((r) => ({
          job: r.j.id,
          tech: r.t,
          time: r.j.scheduledStart ? fmtDayTime(r.j.scheduledStart) : null,
          status: r.j.status,
          priority: r.j.priority,
          title: r.j.title,
          customer: r.c,
          valueUsd: r.j.estValueCents / 100,
        }))
    },
  },
  {
    name: 'find_customer',
    description: 'Search customers by name, email, phone or address. Returns equipment and recent jobs.',
    params: z.object({ query: z.string() }),
    handler: async (a) => {
      const q = `%${a.query}%`
      const cs = await db
        .select()
        .from(schema.customers)
        .where(or(ilike(schema.customers.name, q), ilike(schema.customers.email, q), ilike(schema.customers.phone, q), ilike(schema.customers.address, q)))
        .limit(5)
      return Promise.all(
        cs.map(async (c) => ({
          ...c,
          equipment: await db.select().from(schema.equipment).where(eq(schema.equipment.customerId, c.id)),
          jobs: (await db.select().from(schema.jobs).where(eq(schema.jobs.customerId, c.id))).map((j) => ({ id: j.id, title: j.title, status: j.status, when: j.scheduledStart })),
        })),
      )
    },
  },
  {
    name: 'mark_technician_out',
    description: 'Mark a technician unavailable (sick, truck broke down) and re-plan the fleet. Their visits move to others.',
    params: z.object({ name: z.string().describe('first name'), reason: z.string() }),
    handler: async (a) => {
      const [t] = await db
        .select()
        .from(schema.technicians)
        .where(ilike(schema.technicians.name, `${a.name}%`))
      if (!t) return { error: 'no such technician' }
      await db.update(schema.technicians).set({ active: false }).where(eq(schema.technicians.id, t.id))
      await db
        .update(schema.jobs)
        .set({ technicianId: null, lockedTech: false })
        .where(and(eq(schema.jobs.technicianId, t.id), eq(schema.jobs.status, 'scheduled')))
      const res = await replan({ reason: `${t.name} out: ${a.reason}` })
      return { technician: t.name, moved: res.moved.length, unassigned: res.unassigned, travelMin: res.travelMin }
    },
  },
  {
    name: 'mark_technician_back',
    description: 'Make a technician available again and re-plan.',
    params: z.object({ name: z.string() }),
    handler: async (a) => {
      const [t] = await db
        .select()
        .from(schema.technicians)
        .where(ilike(schema.technicians.name, `${a.name}%`))
      if (!t) return { error: 'no such technician' }
      await db.update(schema.technicians).set({ active: true }).where(eq(schema.technicians.id, t.id))
      const res = await replan({ reason: `${t.name} back` })
      return { technician: t.name, moved: res.moved.length }
    },
  },
  {
    name: 'move_job',
    description: 'Ask to move a job to another day (and optionally pin it to a technician). Needs owner approval per policy.',
    params: z.object({
      jobId: z.number().int(),
      day: z.string().describe('YYYY-MM-DD'),
      from: z.string().default('08:00'),
      to: z.string().default('17:00'),
      technician: z.string().optional(),
    }),
    handler: async (a) =>
      act(null, {
        policy: 'move_booked_job',
        tool: 'move_job',
        args: a,
        summary: `Move job #${a.jobId} to ${a.day} ${a.from}–${a.to}${a.technician ? ` with ${a.technician}` : ''}`,
      }),
  },
  {
    name: 'simulate_weather',
    description: 'Demo control: pretend a cold snap or heat wave is coming (affects triage priority and the weather campaign). mode=off restores real weather.',
    params: z.object({ mode: z.enum(['cold_snap', 'heat_wave', 'off']) }),
    handler: async (a) => {
      setWeatherOverride(a.mode === 'cold_snap' ? { tempC: -14, minC: -20, maxC: -8 } : a.mode === 'heat_wave' ? { tempC: 36, minC: 22, maxC: 38 } : null)
      return { ok: true, mode: a.mode }
    },
  },
  {
    name: 'run_weather_campaign',
    description: 'Check the forecast and draft a proactive maintenance campaign if a cold snap or heat wave is coming.',
    params: z.object({}),
    handler: async () => (await import('../jobs/ops')).weatherScan(),
  },
  {
    name: 'business_snapshot',
    description: 'Open requests, approvals waiting, unpaid invoices and revenue numbers.',
    params: z.object({}),
    handler: async () => {
      const [inv, ap, reqs] = await Promise.all([
        db.select().from(schema.invoices),
        db.select().from(schema.approvals).where(eq(schema.approvals.status, 'pending')),
        db.select().from(schema.requests),
      ])
      const sum = (xs: typeof inv) => xs.reduce((a, i) => a + i.totalCents, 0) / 100
      return {
        approvalsWaiting: ap.map((x) => ({ id: x.id, summary: x.summary })),
        invoices: { paidUsd: sum(inv.filter((i) => i.status === 'paid')), unpaidUsd: sum(inv.filter((i) => i.status === 'sent')), count: inv.length },
        requests: {
          total: reqs.length,
          open: reqs.filter((r) => ['new', 'triaged', 'awaiting_customer'].includes(r.status)).length,
          p1: reqs.filter((r) => r.priority === 1).length,
        },
      }
    },
  },
]

registerExecutor('move_job', async (a) => {
  const jobId = Number(a.jobId)
  let techId: number | null = null
  if (a.technician) {
    const [t] = await db
      .select()
      .from(schema.technicians)
      .where(ilike(schema.technicians.name, `${a.technician}%`))
    techId = t?.id ?? null
  }
  const day = String(a.day)
  await db
    .update(schema.jobs)
    .set({ windowStart: zoned(day, String(a.from ?? '08:00')), windowEnd: zoned(day, String(a.to ?? '17:00')), ...(techId ? { technicianId: techId, lockedTech: true } : {}) })
    .where(eq(schema.jobs.id, jobId))
  const res = await replan({ reason: `owner moved job #${jobId}` })
  return { moved: res.moved.length }
})

export async function ownerChat(history: Content[], message: string): Promise<{ text: string; history: Content[]; used: string[]; runId?: string }> {
  const next: Content[] = [...history, { role: 'user', parts: [{ text: message }] }]
  if (!aiEnabled()) return { text: 'The AI agent needs GEMINI_API_KEY. Everything else on the dashboard works without it.', history: next, used: [] }
  const run = await Run.start('ops', 'owner_chat', message.slice(0, 80))
  const s = await getSettings()
  const today = dayOf(new Date())
  const res = await runTools({
    run,
    system: `You are ${s.persona.agentName}, the AI operations agent for ${s.company.name} (Denver), talking to the owner or office staff. Today is ${today}; tomorrow is ${addDays(today, 1)}. Answer the owner briefly and concretely, using tools for facts. When an action needs approval, say it is waiting in Approvals. Never invent jobs, customers or numbers.`,
    history: next,
    tools,
  })
  await run.end('done', res.text.slice(0, 120))
  // tools called while answering this message, so the chat can show what the agent did
  const used = res.history
    .slice(next.length)
    .flatMap((c) => c.parts ?? [])
    .map((p) => p.functionCall?.name)
    .filter((n): n is string => !!n)
  return { ...res, used: [...new Set(used)], runId: run.id }
}
