import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db, schema } from '../db'

/**
 * Everything that happened to one request, for the owner: how it came in, every message and call,
 * the visit with its slot and technician, what the technician did, invoices, quotes, agent runs and
 * the event log entries that mention any of it.
 */
export async function requestStory(requestId: number) {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId))
  if (!request) return null
  const [customer] = request.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, request.customerId)) : []
  const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.requestId, requestId))
  const jobIds = jobs.map((j) => j.id)
  const techs = await db.select({ id: schema.technicians.id, name: schema.technicians.name, color: schema.technicians.color }).from(schema.technicians)
  const calls = await db.select().from(schema.calls).where(eq(schema.calls.requestId, requestId))
  const messages = await db
    .select()
    .from(schema.messages)
    .where(or(eq(schema.messages.requestId, requestId), jobIds.length ? inArray(schema.messages.jobId, jobIds) : sql`false`))
  const quotes = await db.select().from(schema.quotes).where(eq(schema.quotes.requestId, requestId))
  const invoices = jobIds.length ? await db.select().from(schema.invoices).where(inArray(schema.invoices.jobId, jobIds)) : []

  const ids = (k: string, xs: number[]) =>
    xs.length
      ? sql`(${schema.events.payload}->>${k})::bigint in (${sql.join(
          xs.map((x) => sql`${x}`),
          sql`, `,
        )})`
      : sql`false`
  const events = await db
    .select()
    .from(schema.events)
    .where(
      and(
        // location pings are noise here; the map has them
        sql`${schema.events.type} <> 'tech.location'`,
        or(
          ids('requestId', [requestId]),
          ids('jobId', jobIds),
          ids(
            'callId',
            calls.map((c) => c.id),
          ),
          ids(
            'quoteId',
            quotes.map((q) => q.id),
          ),
          ids(
            'invoiceId',
            invoices.map((i) => i.id),
          ),
        ),
      ),
    )
    .orderBy(schema.events.id)
    .limit(300)

  const subjects = [`request #${requestId}`, ...jobIds.map((id) => `job #${id}`), request.rawText.slice(0, 80)]
  const runs = await db
    .select({
      id: schema.agentRuns.id,
      agent: schema.agentRuns.agent,
      trigger: schema.agentRuns.trigger,
      outcome: schema.agentRuns.outcome,
      status: schema.agentRuns.status,
      startedAt: schema.agentRuns.startedAt,
    })
    .from(schema.agentRuns)
    .where(inArray(schema.agentRuns.subject, subjects))
    .orderBy(desc(schema.agentRuns.startedAt))
    .limit(30)

  return { request, customer: customer ?? null, jobs, techs, calls, messages, quotes, invoices, events, runs }
}
export type RequestStory = NonNullable<Awaited<ReturnType<typeof requestStory>>>

/** One person's whole conversation with the business: every message both ways, plus calls for a customer. */
export async function conversation(who: { customerId?: number; technicianId?: number }) {
  if (who.customerId) {
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, who.customerId))
    if (!customer) return null
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.customerId, who.customerId)).orderBy(schema.messages.createdAt).limit(300)
    const calls = await db.select().from(schema.calls).where(eq(schema.calls.customerId, who.customerId)).orderBy(schema.calls.startedAt)
    return { kind: 'customer' as const, name: customer.name, email: customer.email, phone: customer.phone, customerId: customer.id, messages, calls }
  }
  if (who.technicianId) {
    const [t] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, who.technicianId))
    if (!t) return null
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.technicianId, who.technicianId)).orderBy(schema.messages.createdAt).limit(300)
    return { kind: 'technician' as const, name: t.name, color: t.color, email: null, phone: null, customerId: null, messages, calls: [] }
  }
  return null
}
export type Conversation = NonNullable<Awaited<ReturnType<typeof conversation>>>
