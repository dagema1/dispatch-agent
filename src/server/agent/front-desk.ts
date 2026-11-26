import { eq, ilike, or } from 'drizzle-orm'
import { db, schema } from '../db'
import { defaultWindow, replan } from '../domain/dispatch'
import { alertOwner, firstName, messageCustomer, messageTechnician } from '../domain/messaging'
import { personalize } from '../domain/persona'
import { getSettings } from '../domain/settings'
import { safetyCheck, triage } from '../domain/triage'
import type { Media } from '../integrations/gemini'
import { geocode, haversineKm } from '../integrations/routing'
import { getWeather } from '../integrations/weather'
import { publish } from '../lib/bus'
import { links } from '../lib/links'
import { dayOf, fmtDayTime, fmtTime } from '../lib/time'
import { diagnoseAndQuote } from './diagnosis'
import { act, registerExecutor } from './policy'
import { Run } from './trace'

export type Inbound = {
  channel: 'voice' | 'email' | 'web' | 'sim'
  text: string
  externalId?: string
  customer?: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null }
  photos?: Media[]
  /** for the simulator: do not send messages or replan */
  dryRun?: boolean
}

export type IntakeResult = {
  requestId: number
  customerId: number
  priority: number
  safety: string | null
  jobId?: number
  booking?: { technician: string; start: string; end: string; startText: string }
  quoteId?: number
  replyText: string
  status: 'booked' | 'awaiting_customer' | 'escalated' | 'duplicate'
}

registerExecutor('send_customer_message', async (a) => messageCustomer(a as Parameters<typeof messageCustomer>[0]))

/**
 * Front-desk agent: one pipeline for every channel (voice, email, web chat).
 * Safety first → identify customer → weather → triage → (photos → diagnosis & quote)
 * → create job → dispatch agent re-plans the fleet → confirm with the customer → brief the tech.
 * Each side effect goes through the policy engine; every step is traced.
 */
export async function handleInbound(input: Inbound): Promise<IntakeResult> {
  const receivedAt = new Date()
  if (input.externalId) {
    const [dup] = await db.select().from(schema.requests).where(eq(schema.requests.externalId, input.externalId))
    if (dup) return { requestId: dup.id, customerId: dup.customerId ?? 0, priority: dup.priority ?? 3, safety: dup.safetyFlag, replyText: '', status: 'duplicate' }
  }
  const run = await Run.start('front_desk', input.channel, input.text.slice(0, 80))
  try {
    const settings = await getSettings()

    // 1. Safety rules are code, not model output, and run before anything else.
    const safety = safetyCheck(input.text)
    if (safety) await run.step('policy', 'safety_rule', { text: input.text.slice(0, 200) }, safety)

    // 2. Identify or create the customer.
    let customer = await findCustomer(input.customer)
    const weatherAt = customer?.lat != null ? { lat: customer.lat, lng: customer.lng! } : settings.company.hq
    const weather = await run.timed('tool', 'weather', weatherAt, () => getWeather(weatherAt))

    // 3. Triage (rules + model + weather).
    const t = await triage(input.text, weather, run)
    if (!customer)
      customer = await createCustomer(run, {
        ...input.customer,
        name: input.customer?.name ?? t.customerName,
        address: input.customer?.address ?? t.address,
        phone: input.customer?.phone ?? t.phone,
        email: input.customer?.email ?? t.email,
      })

    const [req] = await db
      .insert(schema.requests)
      .values({
        channel: input.channel,
        externalId: input.externalId,
        customerId: customer?.id,
        rawText: input.text,
        summary: t.summary,
        extracted: { ...t, weatherF: weather ? Math.round((weather.tempC * 9) / 5 + 32) : null },
        priority: t.priority,
        trade: t.trade,
        skill: t.skill,
        safetyFlag: t.safety,
        estMinutes: t.estMinutes,
        estValueCents: t.estValueCents,
        status: 'triaged',
        createdAt: receivedAt,
      })
      .returning()
    await publish('request.created', { requestId: req.id, channel: input.channel, priority: t.priority, issue: t.issue, customer: customer?.name ?? null, safety: t.safety })

    if (safety) await alertOwner(`P1 SAFETY (${safety.flag}) from ${customer?.name ?? 'unknown caller'}: ${t.issue}`)

    // 4. Missing essentials → ask one clarifying question instead of guessing.
    if (!customer || customer.lat == null) {
      const ask = `${safety ? `${safety.script}\n\n` : ''}Thanks for contacting ${settings.company.name}. So we can send the right technician, please reply with your full name, service address and a phone number.`
      if (customer && !input.dryRun)
        await act(run, {
          policy: 'send_customer_message',
          tool: 'send_customer_message',
          args: { customerId: customer.id, requestId: req.id, subject: `Re: ${t.issue}`, body: ask, channel: chan(input) },
          summary: `Ask ${customer.name} for address`,
        })
      await db.update(schema.requests).set({ status: 'awaiting_customer' }).where(eq(schema.requests.id, req.id))
      await run.end('done', 'asked for address')
      return {
        requestId: req.id,
        customerId: customer?.id ?? 0,
        priority: t.priority,
        safety: t.safety,
        replyText: personalize(ask, customer?.name, settings.persona),
        status: 'awaiting_customer',
      }
    }
    const distance = haversineKm(settings.company.hq, { lat: customer.lat, lng: customer.lng! })
    if (distance > settings.company.serviceRadiusKm) {
      const msg = `Thanks for reaching out. Unfortunately ${customer.address} is outside our service area, so we can't send a technician. We recommend contacting a local licensed contractor.`
      if (!input.dryRun)
        await act(run, {
          policy: 'send_customer_message',
          tool: 'send_customer_message',
          args: { customerId: customer.id, requestId: req.id, subject: `Re: ${t.issue}`, body: msg, channel: chan(input) },
          summary: 'Out-of-area reply',
        })
      await db.update(schema.requests).set({ status: 'closed' }).where(eq(schema.requests.id, req.id))
      await run.end('done', `outside service area (${distance.toFixed(0)} km)`)
      return { requestId: req.id, customerId: customer.id, priority: t.priority, safety: t.safety, replyText: msg, status: 'escalated' }
    }

    // 5. Photos → diagnosis agent → good/better/best quote.
    let quoteId: number | undefined
    let replacementLead = false
    if (input.photos?.length) {
      const q = await diagnoseAndQuote({ requestId: req.id, customerId: customer.id, description: input.text, photos: input.photos, run })
      quoteId = q.quote.id
      replacementLead = q.replacementLead
    }

    // 6. Create the job and let the dispatch agent fit it into the fleet plan.
    const win = defaultWindow(t.priority)
    const [job] = await db
      .insert(schema.jobs)
      .values({
        requestId: req.id,
        customerId: customer.id,
        title: t.issue,
        priority: t.priority,
        skill: replacementLead ? 'hvac_install' : t.skill,
        durationMin: t.estMinutes,
        estValueCents: t.estValueCents,
        windowStart: win.start,
        windowEnd: win.end,
      })
      .returning()
    await run.step('tool', 'create_job', { priority: t.priority, skill: job.skill, window: [win.start, win.end] }, { jobId: job.id })
    if (quoteId) await db.update(schema.quotes).set({ jobId: job.id }).where(eq(schema.quotes.id, quoteId))

    if (input.dryRun) {
      await run.end('done', `dry run job #${job.id}`)
      return { requestId: req.id, customerId: customer.id, priority: t.priority, safety: t.safety, jobId: job.id, replyText: '', status: 'booked' }
    }

    const plan = await replan({ reason: `new P${t.priority} request #${req.id}`, run })
    const [placed] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id))
    const tech = placed.technicianId ? (await db.select().from(schema.technicians).where(eq(schema.technicians.id, placed.technicianId)))[0] : null

    // 7. Reply to the customer (one message: safety advice, booking, quote, tracking link).
    const parts: string[] = []
    if (safety) parts.push(safety.script)
    let booking: IntakeResult['booking']
    if (tech && placed.scheduledStart) {
      const start = placed.scheduledStart
      const arrivalTo = new Date(start.getTime() + 60 * 60_000)
      booking = { technician: tech.name, start: start.toISOString(), end: placed.scheduledEnd!.toISOString(), startText: `${fmtDayTime(start)}` }
      parts.push(
        `Hi ${firstName(customer.name)}, you're booked. ${firstName(tech.name)} will arrive ${dayOf(start) === dayOf(new Date()) ? 'today' : fmtDayTime(start).split(',').slice(0, 2).join(',')} between ${fmtTime(start)} and ${fmtTime(arrivalTo)} for: ${t.issue}.`,
        `Track your technician live on the day: ${links.track(job.id)}`,
      )
    } else {
      parts.push(
        `Hi ${firstName(customer.name)}, we've logged your request (${t.issue}). Our schedule is full right now, so the office will call you shortly with the first available time.`,
      )
      await alertOwner(`Could not fit P${t.priority} job #${job.id} (${t.issue}) for ${customer.name}: needs a manual decision`, { replan: true })
    }
    if (quoteId) parts.push(`From your photos we've prepared repair and replacement options with upfront prices: ${links.quote(quoteId)}`)
    else if (t.priority > 1) parts.push(`If you can, send photos of the unit and its label here so the technician brings the right parts: ${links.photos(req.id)}`)
    const reply = personalize(parts.join('\n\n'), customer.name, settings.persona)

    if (input.channel !== 'voice') {
      await act(run, {
        policy: 'send_customer_message',
        tool: 'send_customer_message',
        args: { customerId: customer.id, requestId: req.id, jobId: job.id, subject: `Your ${settings.company.name} appointment`, body: reply, channel: chan(input) },
        summary: `Confirm booking with ${customer.name}`,
        confidence: t.confidence,
      })
    }
    await db
      .update(schema.requests)
      .set({ status: booking ? 'booked' : 'escalated', firstResponseAt: new Date() })
      .where(eq(schema.requests.id, req.id))
    if (tech && placed.scheduledStart && dayOf(placed.scheduledStart) === dayOf(new Date())) {
      await messageTechnician(
        tech.id,
        `🆕 <b>P${t.priority} added to your route</b>\n#${job.id} ${t.issue}\n${customer.name}, ${customer.address}\nArrive ${fmtTime(placed.scheduledStart)}${replacementLead ? '\n💡 Replacement opportunity (old unit) — quote attached in dashboard' : ''}`,
        job.id,
      )
    }
    await run.end(
      'done',
      booking
        ? `booked #${job.id} with ${tech!.name} ${booking.startText} (moved ${plan.moved.length} other ${plan.moved.length === 1 ? 'visit' : 'visits'})`
        : `job #${job.id} unplaced, escalated`,
    )
    return {
      requestId: req.id,
      customerId: customer.id,
      priority: t.priority,
      safety: t.safety,
      jobId: job.id,
      booking,
      quoteId,
      replyText: reply,
      status: booking ? 'booked' : 'escalated',
    }
  } catch (e) {
    await run.step('error', 'intake', null, { error: (e as Error).message })
    await run.end('failed', (e as Error).message)
    throw e
  }
}

const chan = (i: Inbound) => (i.channel === 'voice' ? 'voice' : i.channel === 'web' ? 'web' : 'email')

async function findCustomer(c: Inbound['customer']) {
  if (!c) return null
  const conds = []
  if (c.email) conds.push(ilike(schema.customers.email, c.email))
  if (c.phone) conds.push(eq(schema.customers.phone, c.phone))
  if (!conds.length && c.name) conds.push(ilike(schema.customers.name, c.name))
  if (!conds.length) return null
  const [hit] = await db
    .select()
    .from(schema.customers)
    .where(or(...conds))
    .limit(1)
  return hit ?? null
}

async function createCustomer(run: Run, c: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null }) {
  if (!c.name && !c.email && !c.phone) return null
  const loc = c.address ? await run.timed('tool', 'geocode', { address: c.address }, () => geocode(c.address!)) : null
  const [row] = await db
    .insert(schema.customers)
    .values({ name: c.name ?? c.email ?? 'Customer', email: c.email, phone: c.phone, address: c.address ?? 'unknown', lat: loc?.lat, lng: loc?.lng })
    .returning()
  return row
}
