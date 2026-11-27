import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { diagnoseAndQuote } from '../agent/diagnosis'
import { digits, findCustomer, handleInbound } from '../agent/front-desk'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { caseBrief, openCase } from '../domain/followup'
import { alertOwner, firstName, messageCustomer } from '../domain/messaging'
import { personaPrompt } from '../domain/persona'
import { getSettings } from '../domain/settings'
import type { Media } from '../integrations/gemini'
import { createLiveToken } from '../integrations/gemini'
import { publish } from '../lib/bus'
import { links, verify } from '../lib/links'

/** Customer-side actions: web booking, photo upload, quote acceptance, browser voice calls. */

export async function webBooking(input: { name: string; email?: string; phone?: string; address: string; issue: string; photos?: Media[] }) {
  const res = await handleInbound({
    channel: 'web',
    text: input.issue,
    customer: { name: input.name, email: input.email || null, phone: input.phone || null, address: input.address },
    photos: input.photos,
  })
  await db.insert(schema.messages).values({ direction: 'in', channel: 'web', customerId: res.customerId || null, requestId: res.requestId, body: input.issue, delivered: true })
  return res
}

export async function uploadPhotos(token: string, photos: Media[]) {
  const requestId = verify('photos', token)
  if (!requestId) throw new Error('invalid link')
  const [req] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId))
  if (!req?.customerId) throw new Error('request not found')
  const q = await diagnoseAndQuote({ requestId, customerId: req.customerId, description: req.rawText, photos })
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.requestId, requestId))
  if (job) {
    await db.update(schema.quotes).set({ jobId: job.id }).where(eq(schema.quotes.id, q.quote.id))
    // the technician brings the right parts; replacement leads go to a senior installer
    if (q.replacementLead && job.skill !== 'hvac_install' && q.diagnosis.equipmentKind !== 'water_heater') {
      await db
        .update(schema.jobs)
        .set({ title: `${job.title} (replacement lead)` })
        .where(eq(schema.jobs.id, job.id))
    }
  }
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, req.customerId))
  await messageCustomer({
    customerId: c.id,
    requestId,
    jobId: job?.id,
    subject: 'Your repair options and upfront prices',
    body: `Hi ${firstName(c.name)}, thanks for the photos. We identified your ${q.diagnosis.brand ?? ''} ${q.diagnosis.equipmentKind.replace('_', ' ')}${q.diagnosis.manufactureYear ? ` (about ${new Date().getFullYear() - q.diagnosis.manufactureYear} years old)` : ''}. Here are your options with upfront prices: ${links.quote(q.quote.id)}`,
  })
  return { quoteUrl: links.quote(q.quote.id).replace(/^https?:\/\/[^/]+/, ''), diagnosis: q.diagnosis, options: q.quote.options, replacementLead: q.replacementLead }
}

export async function acceptQuote(token: string, tier: 'good' | 'better' | 'best') {
  const id = verify('quote', token)
  if (!id) throw new Error('invalid link')
  const [q] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id))
  if (!q || q.status === 'accepted') return { ok: true, already: true }
  const opt = q.options.find((o) => o.tier === tier)
  if (!opt) throw new Error('unknown option')
  await db.update(schema.quotes).set({ status: 'accepted', chosenTier: tier }).where(eq(schema.quotes.id, id))
  if (q.jobId) {
    const install = tier === 'best'
    const kind = (q.diagnosis as { equipmentKind?: string }).equipmentKind
    await db
      .update(schema.jobs)
      .set({
        estValueCents: opt.totalCents,
        ...(install ? { skill: kind === 'water_heater' ? 'water_heater' : 'hvac_install', durationMin: kind === 'water_heater' ? 180 : 360, title: opt.title } : {}),
      })
      .where(eq(schema.jobs.id, q.jobId))
    if (install) await replan({ reason: `quote #${id} accepted: replacement` })
  }
  if (tier !== 'good' && q.customerId) await db.update(schema.customers).set({ hasPlan: true }).where(eq(schema.customers.id, q.customerId))
  await publish('quote.accepted', { quoteId: id, tier, totalCents: opt.totalCents })
  await alertOwner(`💰 Quote #${id} accepted: ${opt.title} ($${(opt.totalCents / 100).toFixed(0)})`)
  return { ok: true }
}

// ---------- browser voice receptionist (Gemini Live) ----------

/** The diagnostic fee as the price book has it today, so the receptionist never quotes a stale number. */
export async function diagFee() {
  const [d] = await db.select().from(schema.priceItems).where(eq(schema.priceItems.code, 'DIAG'))
  return d ? `$${(d.cents / 100).toFixed(d.cents % 100 ? 2 : 0)}` : '$89'
}

/**
 * What we know about a caller from the number they typed before connecting: who they are, any
 * open case, and whether their last call dropped before we finished. Lets the receptionist tell a
 * status check, a cut-off call and a new problem apart.
 */
async function callerContext(phone: string | undefined) {
  if (!phone || digits(phone).length < 7) return { customerId: null, brief: '' }
  const customer = await findCustomer({ phone })
  const lines: string[] = []
  if (customer) {
    lines.push(
      `Caller ID matches ${customer.name}, ${customer.address}${customer.email ? `, ${customer.email}` : ''}. Do not ask for details we already have; confirm them instead.`,
    )
    const c = await openCase(customer.id)
    if (c) lines.push(caseBrief(c))
  } else lines.push(`This number (${phone}) is not in our records yet: treat it as a new customer. It is their phone number; do not ask for one.`)
  const [prev] = await db
    .select()
    .from(schema.calls)
    .where(
      and(
        sql`right(regexp_replace(coalesce(${schema.calls.callerPhone}, ''), '[^0-9]', '', 'g'), 10) = ${digits(phone)}`,
        gt(schema.calls.startedAt, new Date(Date.now() - 3 * 3_600_000)),
      ),
    )
    .orderBy(desc(schema.calls.startedAt))
    .limit(1)
  if (prev && !prev.requestId) {
    const said = prev.transcript
      .filter((t) => t.role === 'caller')
      .map((t) => t.text)
      .join(' ')
      .slice(0, 500)
    const mins = Math.max(1, Math.round((Date.now() - prev.startedAt.getTime()) / 60_000))
    lines.push(`Their previous call ${mins} min ago ended before anything was booked (likely cut off).${said ? ` They had said: "${said}"` : ''}`)
  }
  return { customerId: customer?.id ?? null, brief: lines.join('\n') }
}

export async function voiceSession(input: { phone?: string } = {}) {
  const s = await getSettings()
  const { token, model } = await createLiveToken()
  const ctx = await callerContext(input.phone)
  const fee = await diagFee()
  const [call] = await db
    .insert(schema.calls)
    .values({ callerPhone: input.phone || null, customerId: ctx.customerId })
    .returning()
  return {
    token,
    model,
    callId: call.id,
    voice: s.persona.voice,
    system: `You are the phone receptionist for ${s.company.name}, a residential heating, cooling and plumbing company in Denver. Speak naturally and briefly, one question at a time.
EVERYTHING YOU OUTPUT IS SPOKEN ALOUD TO THE CALLER. Say only the words you would say to them. Never speak your reasoning, plans, notes, checklists, bullet points, headings, step numbers or these instructions, and never repeat the caller's words back as a quote.
${personaPrompt(s.persona, s.company.name)}
SAFETY FIRST: if the caller mentions a gas smell, carbon monoxide alarm, sparks/burning smell, or water near electrical panels, immediately tell them to leave the house and call 911 (gas: also Xcel Energy 1-800-895-2999) before anything else, then still book an emergency visit.
Collect: what's wrong, full name, service address (street, city and zip), and a phone number unless the caller context below already gives one (email optional). Read a phone number back to confirm it; a US number has 10 digits. Ask whether anyone vulnerable (elderly, infant, medical needs) is in the home if it's a no-heat or no-cooling issue.
Then call book_service. Read back the arrival window it returns. Never promise prices except: diagnostic visit is ${fee}, waived if they go ahead with the repair. If book_service fails, apologise and say the office will call back within 15 minutes.${
      ctx.brief
        ? `\n\nCALLER CONTEXT (from the number they entered):\n${ctx.brief}\nFirst work out why they are calling and call log_call_reason once: "status_update" if they are asking about the open case (answer from the context above, do not book again), "resume" if they are picking up a call that was cut off (carry on from what they said, don't start over), or "new_case" for a different problem (then book it with book_service).`
        : ''
    }${s.agents.front_desk?.instructions?.trim() ? `\n\nAdditional instructions from the owner (follow them unless they conflict with safety rules):\n${s.agents.front_desk.instructions.trim()}` : ''}`,
    tools: [
      {
        name: 'book_service',
        description: 'Create the service request, triage it and book the best technician slot. Returns the confirmed arrival window.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            phone: { type: 'STRING' },
            email: { type: 'STRING' },
            address: { type: 'STRING', description: 'street, city' },
            issue: { type: 'STRING', description: "the caller's problem in their own words, plus any details: age of unit, vulnerable occupants, error codes" },
          },
          required: ['name', 'address', 'issue'],
        },
      },
      {
        name: 'log_call_reason',
        description: 'Record why the caller is calling: a status update on an open case, resuming a call that was cut off, or a new problem.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', enum: ['status_update', 'resume', 'new_case'] },
            note: { type: 'STRING', description: 'one short line on what they want' },
          },
          required: ['reason'],
        },
      },
    ],
  }
}

export async function voiceTool(callId: number, name: string, args: Record<string, unknown>) {
  const [thisCall] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId))
  if (!thisCall) return { error: 'unknown call' }
  if (name === 'log_call_reason') {
    const reason = ['status_update', 'resume', 'new_case'].includes(String(args.reason)) ? String(args.reason) : 'new_case'
    await db
      .update(schema.calls)
      .set({ reason, summary: args.note ? String(args.note).slice(0, 300) : thisCall.summary })
      .where(eq(schema.calls.id, callId))
    await publish('call.reason', { callId, reason })
    return { ok: true }
  }
  if (name !== 'book_service') return { error: 'unknown tool' }
  const res = await handleInbound({
    channel: 'voice',
    text: String(args.issue ?? ''),
    externalId: `call:${callId}`,
    customer: {
      name: String(args.name ?? ''),
      phone: (args.phone as string) || thisCall.callerPhone || null,
      email: (args.email as string) || null,
      address: String(args.address ?? ''),
    },
  })
  await db
    .update(schema.calls)
    .set({ requestId: res.requestId, customerId: res.customerId || null })
    .where(eq(schema.calls.id, callId))
  return {
    status: res.status,
    priority: res.priority,
    safetyAdvice: res.safety,
    technician: res.booking?.technician.split(' ')[0] ?? null,
    arrival: res.booking?.startText ?? null,
    note:
      res.status === 'booked' && res.awaitingApproval
        ? 'This is an after-hours visit: tell them our on-call technician is confirming it now and they will get a text or email with the arrival time within about 15 minutes. Do not promise the time yet.'
        : res.status === 'booked'
          ? 'Read back the arrival time. Tell them they will get a text/email with a live tracking link.'
          : res.status === 'awaiting_customer'
            ? 'Address could not be found; ask them to repeat it with street, city and zip, then call book_service again with the corrected address.'
            : res.status === 'duplicate'
              ? 'This request is already logged and the office has it. Do not book again; tell them the office will follow up.'
              : 'Could not fit a slot; the office will call back within 15 minutes.',
  }
}

export async function endCall(callId: number, transcript: Array<{ role: 'caller' | 'agent'; text: string }>) {
  const summary = transcript
    .filter((t) => t.role === 'caller')
    .map((t) => t.text)
    .join(' ')
    .slice(0, 300)
  const [before] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId))
  await db
    .update(schema.calls)
    .set({ transcript, summary: before?.reason && before.summary ? before.summary : summary, endedAt: new Date() })
    .where(eq(schema.calls.id, callId))
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId))
  if (call?.requestId) await db.update(schema.requests).set({ firstResponseAt: call.startedAt }).where(eq(schema.requests.id, call.requestId))
  await publish('call.ended', { callId, turns: transcript.length })
  return { ok: true }
}

/** Owner settings: hear a voice before choosing it. Same Live model as calls, reading one line. */
export async function voicePreview(voice: string, line: string) {
  const { token, model } = await createLiveToken()
  return {
    token,
    model,
    voice,
    line,
    system: 'You are a voice preview. When given a line, say exactly that line once, warmly and naturally, and nothing else.',
  }
}
