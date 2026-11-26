import { and, desc, eq, gt, inArray, notInArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { links } from '../lib/links'
import { fmtDayTime, fmtTime } from '../lib/time'
import { alertOwner, firstName, messageCustomer } from './messaging'

/**
 * A customer who already has a case open: what we know about it, in one place, so every channel
 * (texts, email, a repeat call) can tell "where's my tech?" apart from a new problem.
 */
export type OpenCase = {
  requestId: number
  issue: string
  status: string
  createdAt: Date
  job: null | { id: number; status: string; title: string; tech: string | null; start: Date | null; end: Date | null; eta: Date | null }
}

export async function openCase(customerId: number): Promise<OpenCase | null> {
  const since = new Date(Date.now() - 7 * 86_400_000)
  const [req] = await db
    .select()
    .from(schema.requests)
    .where(and(eq(schema.requests.customerId, customerId), notInArray(schema.requests.status, ['closed']), gt(schema.requests.createdAt, since)))
    .orderBy(desc(schema.requests.createdAt))
    .limit(1)
  const [row] = await db
    .select({ job: schema.jobs, tech: schema.technicians.name })
    .from(schema.jobs)
    .leftJoin(schema.technicians, eq(schema.technicians.id, schema.jobs.technicianId))
    .where(and(eq(schema.jobs.customerId, customerId), inArray(schema.jobs.status, ['unassigned', 'scheduled', 'en_route', 'on_site'])))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1)
  if (!req && !row) return null
  const j = row?.job
  return {
    requestId: req?.id ?? j?.requestId ?? 0,
    issue: (req?.extracted as { issue?: string } | null)?.issue ?? req?.summary ?? j?.title ?? 'your service visit',
    status: req?.status ?? 'booked',
    createdAt: req?.createdAt ?? j!.createdAt,
    job: j ? { id: j.id, status: j.status, title: j.title, tech: row.tech, start: j.scheduledStart, end: j.scheduledEnd, eta: j.etaAt } : null,
  }
}

/** Where the visit stands, in the words we'd text a customer. */
export function statusLine(c: OpenCase): string {
  const j = c.job
  if (!j) return `We have your request about ${c.issue}. We're fitting you into the schedule and will confirm an arrival window shortly.`
  const tech = j.tech ? firstName(j.tech) : 'Your technician'
  const track = `Track it live: ${links.track(j.id)}`
  if (j.status === 'on_site') return `${tech} is at your home now working on ${j.title.toLowerCase()}.`
  if (j.status === 'en_route') return `${tech} is on the way${j.eta ? ` and should arrive around ${fmtTime(j.eta)}` : ''}. ${track}`
  if (j.status === 'scheduled' && j.start) return `You're booked for ${j.title.toLowerCase()}: ${tech} arrives ${fmtDayTime(j.start)}. ${track}`
  return `We have your request about ${c.issue} and are finding the first open slot. We'll confirm the arrival window as soon as it's set.`
}

/** The receptionist's context for a repeat caller. */
export function caseBrief(c: OpenCase): string {
  const j = c.job
  return `Open case #${c.requestId} (opened ${fmtDayTime(c.createdAt)}): ${c.issue}. ${
    j
      ? `Visit #${j.id} is ${j.status.replace('_', ' ')}${j.tech ? ` with ${j.tech}` : ''}${j.start ? `, planned ${fmtDayTime(j.start)}` : ''}${j.eta ? `, ETA ${fmtTime(j.eta)}` : ''}.`
      : 'No visit booked yet.'
  }`
}

const ASKS_STATUS = /\b(when|eta|status|update|where|still coming|running late|how long|what time|arriv|on (his|her|their|the) way|any news)\b/i
const ASKS_CHANGE = /\b(cancel|reschedul|move (it|the)|different (time|day)|another (time|day)|can't make|cannot make|not home)\b/i
const JUST_THANKS = /^\s*(ok(ay)?|thanks?( you)?|thank you|great|perfect|got it|sounds good|👍)[.!\s]*$/i

export type FollowUp = { kind: 'status_update' | 'change_request' | 'ack'; reply: string | null }

/**
 * A message from a customer with a case already open. Status questions get the live status,
 * change requests go to the office, a plain "thanks" gets nothing back. Anything else is a new
 * problem and returns null, so the front desk triages it as a new case.
 */
export async function followUp(customerId: number, text: string, channel: 'email' | 'sms'): Promise<FollowUp | null> {
  const c = await openCase(customerId)
  if (!c) return null
  if (JUST_THANKS.test(text)) return { kind: 'ack', reply: null }
  const [cust] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId))
  if (ASKS_CHANGE.test(text) && c.job) {
    const reply = `Got it. The office will confirm a new time for ${c.job.title.toLowerCase()} shortly. Your current slot is held until then.`
    await messageCustomer({ customerId, requestId: c.requestId || null, jobId: c.job.id, subject: `Re: ${c.issue}`, body: reply, channel })
    await alertOwner(`${cust?.name ?? 'A customer'} asked to change visit #${c.job.id}: “${text.slice(0, 140)}”`)
    return { kind: 'change_request', reply }
  }
  if (ASKS_STATUS.test(text)) {
    const reply = statusLine(c)
    await messageCustomer({ customerId, requestId: c.requestId || null, jobId: c.job?.id ?? null, subject: `Re: ${c.issue}`, body: reply, channel })
    return { kind: 'status_update', reply }
  }
  return null
}

/** A request still waiting on the customer (we asked for their address): their reply completes it. */
export async function awaitingRequest(customerId: number) {
  const [req] = await db
    .select()
    .from(schema.requests)
    .where(and(eq(schema.requests.customerId, customerId), eq(schema.requests.status, 'awaiting_customer'), gt(schema.requests.createdAt, new Date(Date.now() - 2 * 86_400_000))))
    .orderBy(desc(schema.requests.createdAt))
    .limit(1)
  return req ?? null
}
