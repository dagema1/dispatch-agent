import { and, eq, gte, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import { firstName } from '../domain/messaging'
import { getSettings } from '../domain/settings'
import { publish, subscribe } from '../lib/bus'
import { env } from '../lib/env'
import { links } from '../lib/links'
import { enqueue, registerHandler } from '../lib/queue'
import { addDays, dayOf, fmtTime, zoned } from '../lib/time'
import { act } from './policy'

/**
 * Customer follow-ups that keep a booking or a sale alive, each a durable queue item (deduped,
 * survives restarts) and each message through the policy engine like any other customer message:
 * - visit reminder the evening before (from the watchdog, after 17:00)
 * - review request a few hours after the job is done
 * - quote follow-up two days after a quote nobody has answered
 */
const REVIEW_DELAY_MS = 3 * 3_600_000
const QUOTE_FOLLOWUP_MS = 2 * 86_400_000

/** Called by the watchdog: from 17:00, queue a reminder for every visit booked tomorrow (once each). */
export async function queueVisitReminders(now = new Date()) {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  if (hm < '17:00') return 0
  const tomorrow = addDays(dayOf(now), 1)
  const jobs = await db
    .select({ id: schema.jobs.id, start: schema.jobs.scheduledStart })
    .from(schema.jobs)
    .where(
      and(eq(schema.jobs.status, 'scheduled'), gte(schema.jobs.scheduledStart, zoned(tomorrow, '00:00')), lt(schema.jobs.scheduledStart, zoned(addDays(tomorrow, 1), '00:00'))),
    )
  for (const j of jobs) await enqueue('visit.reminder', { jobId: j.id, day: tomorrow }, { dedupeKey: `remind:${j.id}:${tomorrow}` })
  return jobs.length
}

registerHandler('visit.reminder', async (p) => {
  const [row] = await db
    .select({ j: schema.jobs, c: schema.customers, t: schema.technicians.name })
    .from(schema.jobs)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
    .leftJoin(schema.technicians, eq(schema.technicians.id, schema.jobs.technicianId))
    .where(eq(schema.jobs.id, Number(p.jobId)))
  // moved, cancelled or already started since it was queued: nothing to remind about
  if (!row || row.j.status !== 'scheduled' || !row.j.scheduledStart || dayOf(row.j.scheduledStart) !== p.day) return
  const s = row.j.scheduledStart
  await act(null, {
    policy: 'send_customer_message',
    tool: 'send_customer_message',
    args: {
      customerId: row.c.id,
      jobId: row.j.id,
      subject: 'Reminder: your visit tomorrow',
      body: `Hi ${firstName(row.c.name)}, a reminder that ${row.t ? firstName(row.t) : 'your technician'} is coming tomorrow between ${fmtTime(s)} and ${fmtTime(new Date(s.getTime() + 3_600_000))} for: ${row.j.title}. Track them live on the day: ${links.track(row.j.id)}. Reply if the time no longer works and we'll move it.`,
    },
    summary: `Remind ${row.c.name} about visit #${row.j.id} tomorrow`,
  })
})

registerHandler('review.request', async (p) => {
  const [row] = await db
    .select({ j: schema.jobs, c: schema.customers, t: schema.technicians.name })
    .from(schema.jobs)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
    .leftJoin(schema.technicians, eq(schema.technicians.id, schema.jobs.technicianId))
    .where(eq(schema.jobs.id, Number(p.jobId)))
  if (!row || row.j.status !== 'done') return
  const { company } = await getSettings()
  await act(null, {
    policy: 'send_customer_message',
    tool: 'send_customer_message',
    args: {
      customerId: row.c.id,
      jobId: row.j.id,
      subject: `How did we do, ${firstName(row.c.name)}?`,
      body: `Hi ${firstName(row.c.name)}, thanks for having ${row.t ? firstName(row.t) : 'us'} out today. How did the visit go? Reply with a number from 1 (poor) to 5 (great), plus anything we could do better. Reviews help a small company like ${company.name} a lot.`,
    },
    summary: `Ask ${row.c.name} for a review of visit #${row.j.id}`,
  })
  await publish('review.requested', { jobId: row.j.id, customerId: row.c.id })
})

registerHandler('quote.followup', async (p) => {
  const [q] = await db
    .select()
    .from(schema.quotes)
    .where(eq(schema.quotes.id, Number(p.quoteId)))
  // accepted, declined or withdrawn in the meantime
  if (!q || q.status !== 'sent' || !q.customerId) return
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, q.customerId))
  if (!c) return
  await act(null, {
    policy: 'send_customer_message',
    tool: 'send_customer_message',
    args: {
      customerId: c.id,
      requestId: q.requestId,
      jobId: q.jobId,
      subject: 'Your repair options are still open',
      body: `Hi ${firstName(c.name)}, just checking in on the options we sent for your ${String((q.diagnosis as { equipmentKind?: string }).equipmentKind ?? 'system').replace('_', ' ')}. You can compare them and choose one here: ${links.quote(q.id)}. Questions? Reply to this message and we'll help.`,
    },
    summary: `Follow up on quote #${q.id} with ${c.name}`,
  })
})

const g = globalThis as unknown as { __followUps?: boolean }
if (!g.__followUps) {
  g.__followUps = true
  subscribe((ev) => {
    if (ev.type === 'job.completed')
      void enqueue('review.request', { jobId: ev.payload.jobId }, { runAt: new Date(Date.now() + REVIEW_DELAY_MS), dedupeKey: `review:${ev.payload.jobId}` })
    if (ev.type === 'quote.created')
      void enqueue('quote.followup', { quoteId: ev.payload.quoteId }, { runAt: new Date(Date.now() + QUOTE_FOLLOWUP_MS), dedupeKey: `quotefu:${ev.payload.quoteId}` })
  })
}
