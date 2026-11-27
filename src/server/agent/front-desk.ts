import { eq, ilike, or, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { defaultWindow, replan } from '../domain/dispatch'
import { alertOwner, firstName, messageCustomer, messageTechnician } from '../domain/messaging'
import { personalize } from '../domain/persona'
import { getSettings } from '../domain/settings'
import { safetyCheck, type Triage, triage } from '../domain/triage'
import type { Media } from '../integrations/gemini'
import { geocode, haversineKm } from '../integrations/routing'
import { getWeather } from '../integrations/weather'
import { publish } from '../lib/bus'
import { env } from '../lib/env'
import { links } from '../lib/links'
import { dayOf, fmtDayTime, fmtTime } from '../lib/time'
import { diagnoseAndQuote } from './diagnosis'
import { act, registerExecutor } from './policy'
import { Run } from './trace'

export type Inbound = {
  channel: 'voice' | 'email' | 'sms' | 'web' | 'sim'
  text: string
  externalId?: string
  customer?: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null }
  /** already identified (a reply in an existing thread): skip the lookup */
  customerId?: number
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
  /** booked, but an after-hours call-out waits for the owner's approval before anyone is told */
  awaitingApproval?: boolean
}

registerExecutor('send_customer_message', async (a) => messageCustomer(a as Parameters<typeof messageCustomer>[0]))

/**
 * Front-desk agent: one pipeline for every channel (voice, email, web chat).
 * Safety first → identify customer → weather → triage → (photos → diagnosis & quote)
 * → create job → dispatch agent re-plans the fleet → confirm with the customer → brief the tech.
 * Each side effect goes through the policy engine; every step is traced.
 */
export async function handleInbound(input: Inbound): Promise<IntakeResult> {
  if (input.externalId) {
    const [dup] = await db.select().from(schema.requests).where(eq(schema.requests.externalId, input.externalId))
    // The same call or thread trying again after we asked for a better address picks the request
    // back up; anything else with this id is a repeat and is not booked twice.
    if (dup && !(dup.status === 'awaiting_customer' && dup.customerId && input.customer?.address))
      return { requestId: dup.id, customerId: dup.customerId ?? 0, priority: dup.priority ?? 3, safety: dup.safetyFlag, replyText: '', status: 'duplicate' }
    if (dup) return intake(input, dup)
  }
  return intake(input)
}

/** `resumed`: a request we stopped on (no usable address) that now has corrected details and carries on to booking. */
async function intake(input: Inbound, resumed?: typeof schema.requests.$inferSelect): Promise<IntakeResult> {
  const receivedAt = new Date()
  const run = await Run.start('front_desk', input.channel, resumed ? `request #${resumed.id} (corrected details)` : input.text.slice(0, 80))
  try {
    const settings = await getSettings()

    // 1. Safety rules are code, not model output, and run before anything else.
    const safety = safetyCheck(input.text)
    if (safety) await run.step('policy', 'safety_rule', { text: input.text.slice(0, 200) }, safety)

    // 2. Identify or create the customer (a resumed request already has one).
    const knownId = resumed?.customerId ?? input.customerId
    let customer = knownId ? ((await db.select().from(schema.customers).where(eq(schema.customers.id, knownId)))[0] ?? null) : await findCustomer(input.customer)
    const weatherAt = customer?.lat != null ? { lat: customer.lat, lng: customer.lng! } : settings.company.hq
    const weather = resumed ? null : await run.timed('tool', 'weather', weatherAt, () => getWeather(weatherAt))

    // 3. Triage (rules + model + weather). A resumed request keeps the triage it already has.
    const t = resumed?.extracted ? (resumed.extracted as unknown as Triage) : await triage(input.text, weather, run)
    if (resumed) await run.step('tool', 'resume_request', { requestId: resumed.id, address: input.customer?.address }, { priority: t.priority, issue: t.issue })
    if (!customer)
      customer = await createCustomer(run, {
        ...input.customer,
        name: input.customer?.name ?? t.customerName,
        address: input.customer?.address ?? t.address,
        phone: input.customer?.phone ?? t.phone,
        email: input.customer?.email ?? t.email,
      })
    else if (customer.lat == null && (input.customer?.address || t.address)) {
      // a known customer we were missing an address for (they replied to our question): fill it in
      const addr = (input.customer?.address || t.address) as string
      const loc = await run.timed('tool', 'geocode', { address: addr }, () => geocode(addr))
      if (loc) [customer] = await db.update(schema.customers).set({ address: addr, lat: loc.lat, lng: loc.lng }).where(eq(schema.customers.id, customer.id)).returning()
    }

    const [req] = resumed
      ? [resumed]
      : await db
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
    if (!resumed)
      await publish('request.created', { requestId: req.id, channel: input.channel, priority: t.priority, issue: t.issue, customer: customer?.name ?? null, safety: t.safety })

    if (safety && !resumed) await alertOwner(`P1 SAFETY (${safety.flag}) from ${customer?.name ?? 'unknown caller'}: ${t.issue}`)

    // 4. Missing essentials → ask one clarifying question instead of guessing.
    if (!customer || customer.lat == null) {
      const ask = `${safety ? `${safety.script}\n\n` : ''}Thanks for contacting ${settings.company.name}. So we can send the right technician, please reply with your full name, service address and a phone number.`
      // a caller is still on the line and the receptionist asks out loud; written channels get a message
      if (customer && !input.dryRun && input.channel !== 'voice')
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
      // "never" by default: a person decides what to tell someone we can't serve (refer, make an exception)
      const msg = `Thanks for reaching out. Unfortunately ${customer.address} is outside our service area, so we can't send a technician. We recommend contacting a local licensed contractor.`
      const out = input.dryRun
        ? null
        : await act(run, {
            policy: 'reply_outside_area',
            tool: 'send_customer_message',
            args: { customerId: customer.id, requestId: req.id, subject: `Re: ${t.issue}`, body: msg, channel: chan(input) },
            summary: `Out-of-area reply to ${customer.name} (${distance.toFixed(0)} km away)`,
          })
      const sent = out?.status === 'done'
      await db
        .update(schema.requests)
        .set({ status: sent ? 'closed' : 'escalated' })
        .where(eq(schema.requests.id, req.id))
      if (!sent && !input.dryRun)
        await alertOwner(`Outside the service area: ${customer.name}, ${customer.address} (${distance.toFixed(0)} km), ${t.issue}. Request #${req.id} needs a person to reply.`)
      await run.end('done', `outside service area (${distance.toFixed(0)} km), ${sent ? 'replied' : 'escalated to the office'}`)
      return {
        requestId: req.id,
        customerId: customer.id,
        priority: t.priority,
        safety: t.safety,
        replyText: sent ? msg : 'This address is outside our usual service area. Someone from the office will call you back to talk through options.',
        status: 'escalated',
      }
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
    await publish('job.booked', { jobId: job.id, requestId: req.id, title: job.title, windowStart: win.start.toISOString(), windowEnd: win.end.toISOString() })
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
    else parts.push(`If you can, send photos of the unit and its label here so the technician brings the right parts: ${links.photos(req.id)}`)
    const reply = personalize(parts.join('\n\n'), customer.name, settings.persona)
    const subject = `Your ${settings.company.name} appointment`
    const techText =
      tech && placed.scheduledStart && dayOf(placed.scheduledStart) === dayOf(new Date())
        ? `🆕 <b>P${t.priority} added to your route</b>\n#${job.id} ${t.issue}\n${customer.name}, ${customer.address}\nArrive ${fmtTime(placed.scheduledStart)}${replacementLead ? '\n💡 Replacement opportunity (old unit) — quote attached in dashboard' : ''}`
        : null

    // A visit outside opening hours calls someone out: the owner approves that (policy after_hours_dispatch)
    // before the technician or the customer is told. Phone callers get the written confirmation too.
    let awaitingApproval = false
    if (booking && tech && placed.scheduledStart && outsideHours(placed.scheduledStart, settings.hours)) {
      const out = await act(run, {
        policy: 'after_hours_dispatch',
        tool: 'after_hours_dispatch',
        args: { customerId: customer.id, requestId: req.id, jobId: job.id, technicianId: tech.id, subject, body: reply, channel: chan(input), techText },
        summary: `After-hours call-out: ${tech.name} to ${customer.name} at ${fmtDayTime(placed.scheduledStart)} for ${t.issue}`,
      })
      awaitingApproval = out.status === 'pending_approval'
      if (awaitingApproval)
        await act(run, {
          policy: 'send_customer_message',
          tool: 'send_customer_message',
          args: {
            customerId: customer.id,
            requestId: req.id,
            jobId: job.id,
            subject: `We're arranging your ${settings.company.name} visit`,
            body: personalize(
              [
                safety?.script,
                `Hi ${firstName(customer.name)}, we've got your request (${t.issue}). It's outside our opening hours, so our on-call technician is confirming now. We'll message you the arrival time as soon as it's confirmed, usually within 15 minutes.`,
              ]
                .filter(Boolean)
                .join('\n\n'),
              customer.name,
              settings.persona,
            ),
            channel: chan(input),
          },
          summary: `Tell ${customer.name} the after-hours visit is being confirmed`,
        })
    } else {
      await act(run, {
        policy: 'send_customer_message',
        tool: 'send_customer_message',
        args: { customerId: customer.id, requestId: req.id, jobId: job.id, subject, body: reply, channel: chan(input) },
        summary: `Confirm booking with ${customer.name}`,
        confidence: t.confidence,
      })
      if (tech && techText) await messageTechnician(tech.id, techText, job.id)
    }
    await db
      .update(schema.requests)
      .set({ status: booking ? 'booked' : 'escalated', firstResponseAt: new Date() })
      .where(eq(schema.requests.id, req.id))
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
      awaitingApproval,
    }
  } catch (e) {
    await run.step('error', 'intake', null, { error: (e as Error).message })
    await run.end('failed', (e as Error).message)
    throw e
  }
}

/**
 * The owner fills in what intake was missing (usually an address the map could not place) and the
 * request carries on to booking exactly as if the customer had given it: same triage, same re-plan.
 */
export async function fixAndBook(
  requestId: number,
  details: { name: string; phone?: string | null; email?: string | null; address: string },
): Promise<{ ok: false; reason: string } | { ok: true; result: IntakeResult }> {
  const [req] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId))
  if (!req?.customerId) return { ok: false, reason: 'This request has no customer to fix.' }
  const open = (await db.select().from(schema.jobs).where(eq(schema.jobs.requestId, requestId))).filter((j) => j.status !== 'cancelled')
  if (open.length) return { ok: false, reason: 'This request already has a visit.' }
  const address = details.address.trim()
  const loc = await geocode(address)
  if (!loc) return { ok: false, reason: `We couldn't find "${address}" on the map. Check the street name and add the city and zip.` }
  await db
    .update(schema.customers)
    .set({
      name: details.name.trim(),
      phone: details.phone?.trim() || null,
      email: details.email?.trim() || null,
      address,
      lat: loc.lat,
      lng: loc.lng,
    })
    .where(eq(schema.customers.id, req.customerId))
  await publish('request.fixed', { requestId, customerId: req.customerId, address })
  const result = await intake({ channel: req.channel as Inbound['channel'], text: req.rawText, externalId: req.externalId ?? undefined, customer: { address } }, req)
  return { ok: true, result }
}

/** Is this moment outside opening hours (company time zone)? */
export function outsideHours(d: Date, hours: { open: string; close: string }) {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return hm < hours.open || hm >= hours.close
}

// The approved (or automatic) after-hours call-out: tell the technician and confirm with the customer.
registerExecutor('after_hours_dispatch', async (a) => {
  await messageCustomer({
    customerId: Number(a.customerId),
    requestId: a.requestId ? Number(a.requestId) : null,
    jobId: a.jobId ? Number(a.jobId) : null,
    subject: String(a.subject),
    body: String(a.body),
    channel: a.channel as 'email' | 'sms' | 'voice' | 'web',
  })
  if (a.techText && a.technicianId) await messageTechnician(Number(a.technicianId), String(a.techText), a.jobId ? Number(a.jobId) : undefined)
  return { confirmed: true }
})

const chan = (i: Inbound) => (i.channel === 'voice' ? 'voice' : i.channel === 'web' ? 'web' : i.channel === 'sms' ? 'sms' : 'email')

export async function findCustomer(c: Inbound['customer']) {
  if (!c) return null
  const conds = []
  if (c.email) conds.push(ilike(schema.customers.email, c.email))
  if (c.phone && digits(c.phone).length >= 7) conds.push(phoneMatches(c.phone))
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

export const digits = (p: string) => p.replace(/\D/g, '').slice(-10)
/** Same number whatever the formatting: "(720) 555-0142", "720.555.0142" and "+17205550142" all match. */
export const phoneMatches = (p: string) => sql`right(regexp_replace(coalesce(${schema.customers.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits(p)}`
