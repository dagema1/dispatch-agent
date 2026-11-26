import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { handleInbound } from '../agent/front-desk'
import { db, schema } from '../db'
import { awaitingRequest, followUp } from '../domain/followup'
import { publish } from '../lib/bus'

/**
 * The test inbox: every customer email and text, both directions, shown the way the customer would
 * see it, plus a composer to write back as that customer. Inbound goes through the same pipeline a
 * real Gmail or SMS webhook would use.
 */
export async function inboxThreads() {
  const last = db
    .select({
      customerId: schema.messages.customerId,
      at: sql<Date>`max(${schema.messages.createdAt})`.as('at'),
      n: sql<number>`count(*)::int`.as('n'),
    })
    .from(schema.messages)
    .where(and(isNotNull(schema.messages.customerId), sql`${schema.messages.channel} in ('email','sms')`))
    .groupBy(schema.messages.customerId)
    .as('last')
  const withMsgs = await db
    .select({ c: schema.customers, at: last.at, n: last.n })
    .from(last)
    .innerJoin(schema.customers, eq(schema.customers.id, last.customerId))
    .orderBy(desc(last.at))
    .limit(60)
  const others = await db.select().from(schema.customers).orderBy(asc(schema.customers.name)).limit(80)
  const seen = new Set(withMsgs.map((r) => r.c.id))
  const pick = (c: typeof schema.customers.$inferSelect) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address })
  return {
    active: withMsgs.map((r) => ({ ...pick(r.c), at: new Date(r.at).toISOString(), count: r.n })),
    others: others.filter((c) => !seen.has(c.id)).map(pick),
  }
}

export async function inboxThread(customerId: number) {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.customerId, customerId), sql`${schema.messages.channel} in ('email','sms')`))
    .orderBy(asc(schema.messages.createdAt))
    .limit(300)
  return rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    channel: m.channel as 'email' | 'sms',
    subject: m.subject,
    body: m.body,
    delivered: m.delivered,
    via: m.via,
    createdAt: m.createdAt.toISOString(),
  }))
}

export async function customerSends(input: {
  customerId?: number
  newCustomer?: { name: string; email?: string; phone?: string }
  channel: 'email' | 'sms'
  subject?: string
  body: string
}) {
  let customer = input.customerId ? (await db.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)))[0] : null
  const who = customer ? { name: customer.name, email: customer.email, phone: customer.phone } : (input.newCustomer ?? null)
  const subject = input.channel === 'sms' ? null : input.subject?.trim() || 'Service request'
  const store = async (custId: number | null, requestId: number | null) => {
    await db.insert(schema.messages).values({ direction: 'in', channel: input.channel, customerId: custId, requestId, subject, body: input.body, delivered: true, via: 'test' })
    await publish('message.received', { customerId: custId, channel: input.channel, from: who?.name ?? 'Unknown', preview: input.body.slice(0, 80) })
  }

  // a known customer with a case open: status question, change request or thanks, answered without a new case
  if (customer) {
    const pending = await awaitingRequest(customer.id)
    if (!pending) {
      await store(customer.id, null)
      const f = await followUp(customer.id, input.body, input.channel)
      if (f) return { kind: f.kind, customerId: customer.id }
    } else {
      // they're answering our question: re-run intake on the original problem plus their answer
      await store(customer.id, pending.id)
      await db.update(schema.requests).set({ status: 'closed' }).where(eq(schema.requests.id, pending.id))
      const res = await handleInbound({
        channel: input.channel,
        text: `${pending.rawText}\n\nCustomer reply: ${input.body}`,
        externalId: `test:${Date.now()}`,
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
      })
      return { kind: 'completed_request' as const, customerId: res.customerId, status: res.status }
    }
  }

  const res = await handleInbound({
    channel: input.channel,
    text: subject ? `${subject}\n\n${input.body}` : input.body,
    externalId: `test:${Date.now()}`,
    customer: who ?? undefined,
  })
  if (!customer) {
    customer = res.customerId ? ((await db.select().from(schema.customers).where(eq(schema.customers.id, res.customerId)))[0] ?? null) : null
    await store(customer?.id ?? null, res.requestId)
  } else {
    await db
      .update(schema.messages)
      .set({ requestId: res.requestId })
      .where(and(eq(schema.messages.customerId, customer.id), eq(schema.messages.direction, 'in'), sql`${schema.messages.requestId} is null`))
  }
  return { kind: 'new_case' as const, customerId: customer?.id ?? res.customerId, status: res.status }
}
