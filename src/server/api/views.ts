import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { getSettings } from '../domain/settings'
import { googleAccount } from '../integrations/google'
import { getWeather, getWeatherOverride } from '../integrations/weather'
import { integrations } from '../lib/env'
import { sign, verify } from '../lib/links'
import { addDays, dayOf, zoned } from '../lib/time'

/** Read models for the UI. Kept separate from agents so pages never trigger side effects. */

export async function snapshot() {
  const today = dayOf(new Date())
  const from = zoned(addDays(today, -1), '00:00')
  const to = zoned(addDays(today, 4), '00:00')
  const settings = await getSettings()
  const [techs, jobRows, requests, messages, approvals, invoices, quotes, runs, campaigns, calls, weather, google] = await Promise.all([
    db.select().from(schema.technicians).orderBy(schema.technicians.id),
    db
      .select({ j: schema.jobs, c: schema.customers })
      .from(schema.jobs)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
      .orderBy(schema.jobs.scheduledStart),
    db.select().from(schema.requests).orderBy(desc(schema.requests.createdAt)).limit(60),
    db.select().from(schema.messages).orderBy(desc(schema.messages.createdAt)).limit(80),
    db.select().from(schema.approvals).orderBy(desc(schema.approvals.createdAt)).limit(40),
    db.select().from(schema.invoices).orderBy(desc(schema.invoices.createdAt)),
    db.select().from(schema.quotes).orderBy(desc(schema.quotes.createdAt)).limit(30),
    db.select().from(schema.agentRuns).orderBy(desc(schema.agentRuns.startedAt)).limit(60),
    db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).limit(10),
    db.select().from(schema.calls).orderBy(desc(schema.calls.startedAt)).limit(20),
    getWeather(settings.company.hq),
    googleAccount(),
  ])
  const jobs = jobRows
    .filter(({ j }) => j.status === 'unassigned' || (j.scheduledStart && j.scheduledStart >= from && j.scheduledStart < to) || (j.completedAt && j.completedAt >= from))
    .map(({ j, c }) => ({
      ...j,
      customer: { id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, phone: c.phone, email: c.email },
      trackUrl: `/c/track/${sign('track', j.id)}`,
    }))
  const custIds = [...new Set([...requests.map((r) => r.customerId), ...messages.map((m) => m.customerId), ...invoices.map((i) => i.customerId), ...quotes.map((q) => q.customerId)].filter((x): x is number => !!x))]
  const customers = custIds.length ? await db.select({ id: schema.customers.id, name: schema.customers.name, email: schema.customers.email }).from(schema.customers).where(inArray(schema.customers.id, custIds)) : []
  return {
    now: new Date().toISOString(),
    today,
    company: settings.company,
    settings,
    integrations: { ...integrations(), googleAccount: google },
    weather: weather ? { ...weather, override: getWeatherOverride() } : null,
    techs,
    jobs,
    requests,
    messages,
    approvals,
    invoices,
    quotes: quotes.map((q) => ({ ...q, url: `/c/quote/${sign('quote', q.id)}` })),
    runs,
    campaigns,
    calls,
    customers: Object.fromEntries(customers.map((c) => [c.id, c])),
    kpis: await kpis(),
    lab: await lab(),
  }
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>

/** Last simulator and eval results (stored so the ROI page survives reloads). */
async function lab() {
  const rows = await db.select().from(schema.settings).where(inArray(schema.settings.key, ['sim_last', 'eval_rules', 'eval_model']))
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null
  return {
    sim: get('sim_last') as Awaited<ReturnType<typeof import('../sim/simulator').simulateDay>> | null,
    evalRules: get('eval_rules') as Awaited<ReturnType<typeof import('../sim/evals').runEvals>> | null,
    evalModel: get('eval_model') as Awaited<ReturnType<typeof import('../sim/evals').runEvals>> | null,
  }
}

/** ROI numbers computed from the real event history (not hard-coded). */
export async function kpis() {
  const since = new Date(Date.now() - 7 * 86_400_000)
  const [reqs, inv, runs, jobs] = await Promise.all([
    db.select().from(schema.requests).where(gte(schema.requests.createdAt, since)),
    db.select().from(schema.invoices).where(gte(schema.invoices.createdAt, since)),
    db.select().from(schema.agentRuns).where(gte(schema.agentRuns.startedAt, since)),
    db.select().from(schema.jobs).where(and(eq(schema.jobs.status, 'done'), gte(schema.jobs.completedAt, since))),
  ])
  const responded = reqs.filter((r) => r.firstResponseAt && r.channel !== 'sim')
  const respSec = responded.map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / 1000).sort((a, b) => a - b)
  const median = respSec.length ? respSec[Math.floor(respSec.length / 2)] : null
  const booked = reqs.filter((r) => r.status === 'booked').length
  const paid = inv.filter((i) => i.status === 'paid')
  const tokensIn = runs.reduce((a, r) => a + (r.tokensIn ?? 0), 0)
  const tokensOut = runs.reduce((a, r) => a + (r.tokensOut ?? 0), 0)
  // office-minutes saved: industry rule of thumb per task done by a human dispatcher/CSR
  const minutesSaved = reqs.filter((r) => r.channel !== 'sim').length * 6 + jobs.length * 8 + inv.length * 5
  return {
    requests: reqs.filter((r) => r.channel !== 'sim').length,
    booked,
    bookingRate: reqs.length ? booked / reqs.length : 0,
    medianResponseSec: median,
    afterHours: reqs.filter((r) => {
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hour12: false }).format(r.createdAt))
      return h < 8 || h >= 17
    }).length,
    jobsDone: jobs.length,
    invoicedCents: inv.reduce((a, i) => a + i.totalCents, 0),
    collectedCents: paid.reduce((a, i) => a + i.totalCents, 0),
    daysToPaid: paid.length ? paid.reduce((a, i) => a + (i.paidAt!.getTime() - i.createdAt.getTime()), 0) / paid.length / 86_400_000 : null,
    agentRuns: runs.length,
    tokensIn,
    tokensOut,
    minutesSaved,
  }
}

export async function trace(runId: string) {
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId))
  const steps = await db.select().from(schema.agentSteps).where(eq(schema.agentSteps.runId, runId)).orderBy(schema.agentSteps.id)
  return { run, steps }
}

// ---------- customer-facing (signed links) ----------

export async function trackView(token: string) {
  const jobId = verify('track', token)
  if (!jobId) return null
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId))
  if (!job) return null
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
  const [t] = job.technicianId ? await db.select().from(schema.technicians).where(eq(schema.technicians.id, job.technicianId)) : []
  const settings = await getSettings()
  const liveFresh = t?.liveAt && Date.now() - t.liveAt.getTime() < 15 * 60_000
  return {
    company: settings.company,
    job: { id: job.id, title: job.title, status: job.status, scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd, etaAt: job.etaAt, completedAt: job.completedAt },
    customer: { firstName: c.name.split(' ')[0], lat: c.lat, lng: c.lng },
    tech: t ? { firstName: t.name.split(' ')[0], color: t.color, live: liveFresh && job.status === 'en_route' ? { lat: t.liveLat, lng: t.liveLng, at: t.liveAt } : null } : null,
  }
}

export async function quoteView(token: string) {
  const id = verify('quote', token)
  if (!id) return null
  const [q] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id))
  if (!q?.customerId) return null
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, q.customerId))
  const settings = await getSettings()
  return { company: settings.company, quote: q, customer: { firstName: c.name.split(' ')[0] } }
}

export async function photosView(token: string) {
  const id = verify('photos', token)
  if (!id) return null
  const [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, id))
  if (!r) return null
  const settings = await getSettings()
  return { company: settings.company, request: { id: r.id, summary: r.summary } }
}

export async function paidView(invoiceId: number) {
  const { checkPaid } = await import('../agent/revenue')
  await checkPaid(invoiceId).catch(() => false)
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId))
  const settings = await getSettings()
  return inv ? { company: settings.company, invoice: { id: inv.id, status: inv.status, totalCents: inv.totalCents } } : null
}
