import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { handleInbound } from '../agent/front-desk'
import { act, registerExecutor } from '../agent/policy'
import { sweepPayments } from '../agent/revenue'
import { sendRoute } from '../agent/technician'
import { Run } from '../agent/trace'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { alertOwner, firstName, messageCustomer } from '../domain/messaging'
import { getSettings } from '../domain/settings'
import { aiEnabled, generateJson } from '../integrations/gemini'
import { deleteCalendarEvent, gmailConnected, pollInbox, upsertCalendarEvent } from '../integrations/google'
import { cToF, getWeather } from '../integrations/weather'
import { publish } from '../lib/bus'
import { drain, registerHandler } from '../lib/queue'
import { dayOf, fmtDayTime, fmtTime } from '../lib/time'

/**
 * Proactive work. Three scheduled entry points (Cloud Scheduler → /api/cron/<name>, or the
 * in-process timer when running locally) plus the queue handlers that replan() enqueues.
 */

// ---------- queue handlers ----------

registerHandler('calendar.sync', async (p) => {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, Number(p.jobId)))
  if (!job || !(await gmailConnected())) return
  if (!job.scheduledStart || job.status === 'cancelled' || job.status === 'unassigned') {
    if (job.calendarEventId) {
      await deleteCalendarEvent(job.calendarEventId)
      await db.update(schema.jobs).set({ calendarEventId: null }).where(eq(schema.jobs.id, job.id))
    }
    return
  }
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
  const [t] = job.technicianId ? await db.select().from(schema.technicians).where(eq(schema.technicians.id, job.technicianId)) : []
  const id = await upsertCalendarEvent({
    eventId: job.calendarEventId,
    title: `${t ? firstName(t.name) : '?'} · P${job.priority} ${job.title}`,
    description: `${c.name} ${c.phone ?? ''}\nJob #${job.id}`,
    start: job.scheduledStart,
    end: job.scheduledEnd ?? job.scheduledStart,
    location: c.address,
  })
  if (id && id !== job.calendarEventId) await db.update(schema.jobs).set({ calendarEventId: id }).where(eq(schema.jobs.id, job.id))
})

/** A re-plan moved a booked visit: same-day shifts are announced automatically; a move to another day needs approval. */
registerHandler('notify.moved', async (p) => {
  const jobId = Number(p.jobId)
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId))
  if (!job || job.status === 'done' || job.status === 'cancelled') return
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
  const from = p.from ? new Date(String(p.from)) : null
  if (!job.scheduledStart) {
    await alertOwner(`Job #${jobId} (${job.title}, ${c.name}) lost its slot in the re-plan and needs a manual decision.`, { replan: true })
    return
  }
  if (from && from.getTime() < Date.now()) return // was already past, nothing to announce
  const crossDay = !from || dayOf(from) !== dayOf(job.scheduledStart)
  const to = job.scheduledStart
  const body = `Hi ${firstName(c.name)}, a quick schedule update: your visit for "${job.title}" is now ${crossDay ? fmtDayTime(to) : `today at ${fmtTime(to)}`} (arrival window ${fmtTime(to)}–${fmtTime(new Date(to.getTime() + 3_600_000))}). Reply if that doesn't work and we'll adjust.`
  await act(null, {
    policy: crossDay ? 'move_booked_job' : 'send_customer_message',
    tool: 'send_customer_message',
    args: { customerId: c.id, jobId, subject: 'Your appointment time changed', body },
    summary: `Tell ${c.name} job #${jobId} moved${from ? ` from ${fmtDayTime(from)}` : ''} to ${fmtDayTime(to)}`,
  })
})

// ---------- watchdog (every minute) ----------

const g = globalThis as unknown as { __slaAlerted?: Set<number> }
g.__slaAlerted ??= new Set()
const slaAlerted = g.__slaAlerted

export async function watchdog() {
  const out = { emails: 0, slaBreaches: 0, queue: 0 }
  // 1. new customer emails → front desk
  if (await gmailConnected()) {
    const mails = await pollInbox().catch((e) => {
      console.warn('[gmail] poll', (e as Error).message)
      return []
    })
    for (const m of mails) {
      const res = await handleInbound({ channel: 'email', text: `${m.subject}\n\n${m.text}`, externalId: m.id, customer: { name: m.fromName, email: m.from } }).catch((e) => {
        console.error('[intake]', e)
        return null
      })
      if (res && res.status !== 'duplicate')
        await db
          .insert(schema.messages)
          .values({ direction: 'in', channel: 'email', customerId: res.customerId || null, requestId: res.requestId, subject: m.subject, body: m.text, delivered: true })
      out.emails++
    }
  }
  // 2. SLA: requests nobody has answered in time
  const s = await getSettings()
  const open = await db
    .select()
    .from(schema.requests)
    .where(and(isNull(schema.requests.firstResponseAt), inArray(schema.requests.status, ['new', 'triaged', 'awaiting_customer'])))
  for (const r of open) {
    const limit = (r.priority === 1 ? s.thresholds.slaP1Minutes : s.thresholds.slaOtherMinutes) * 60_000
    if (Date.now() - r.createdAt.getTime() > limit && !slaAlerted.has(r.id)) {
      slaAlerted.add(r.id)
      out.slaBreaches++
      await publish('sla.breach', { requestId: r.id, priority: r.priority })
      await alertOwner(
        `SLA: P${r.priority} request #${r.id} (${r.summary ?? r.rawText.slice(0, 60)}) has no reply after ${Math.round((Date.now() - r.createdAt.getTime()) / 60_000)} min.`,
      )
    }
  }
  // 3. queued work, payments
  out.queue = await drain()
  await sweepPayments()
  return out
}

// ---------- morning plan (06:30) ----------

export async function morningPlan() {
  const run = await Run.start('dispatch', 'cron_morning', dayOf(new Date()))
  const res = await replan({ reason: 'morning plan', run })
  const techs = await db.select().from(schema.technicians).where(eq(schema.technicians.active, true))
  let briefed = 0
  for (const t of techs) {
    if (!t.telegramChatId) continue
    await sendRoute(t.id, t.telegramChatId)
    briefed++
  }
  const today = dayOf(new Date())
  const jobs = await db
    .select()
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ['scheduled', 'unassigned']))
  const todays = jobs.filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === today)
  const unassigned = jobs.filter((j) => j.status === 'unassigned').length
  const value = todays.reduce((a, j) => a + j.estValueCents, 0)
  await alertOwner(
    `☀️ Morning plan: ${todays.length} visits today across ${techs.length} techs, ~$${Math.round(value / 100).toLocaleString()} booked, ${res.travelMin} min driving.${unassigned ? ` ${unassigned} job(s) unassigned.` : ''} Routes sent to ${briefed} tech(s).`,
  )
  await run.end('done', `${todays.length} visits, ${briefed} briefed`)
  return { visits: todays.length, briefed, unassigned, travelMin: res.travelMin }
}

// ---------- weather scan (06:00) ----------

const CampaignSchema = z.object({ subject: z.string(), body: z.string().describe('plain text, under 120 words, friendly, no fake urgency') })

export async function weatherScan() {
  const s = await getSettings()
  const w = await getWeather(s.company.hq)
  if (!w) return { trigger: null }
  const next = w.daily.slice(0, 3)
  const minC = Math.min(w.tempC, ...next.map((d) => d.minC))
  const maxC = Math.max(w.tempC, ...next.map((d) => d.maxC))
  const trigger = minC <= s.thresholds.freezeC ? 'cold_snap' : maxC >= s.thresholds.heatC ? 'heat_wave' : null
  await publish('weather.scanned', { minC, maxC, trigger })
  if (!trigger) return { trigger: null, minC, maxC }

  // one campaign per trigger per day
  const since = new Date(Date.now() - 20 * 3_600_000)
  const [existing] = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.trigger, trigger), gte(schema.campaigns.createdAt, since)))
  if (existing) return { trigger, campaignId: existing.id, minC, maxC }

  const run = await Run.start('ops', 'cron_weather', trigger)
  // target: customers with the relevant equipment, oldest first (most likely to fail)
  const kind = trigger === 'cold_snap' ? ['furnace', 'boiler', 'heat_pump'] : ['ac', 'heat_pump']
  const rows = await db
    .select({ id: schema.customers.id, year: schema.equipment.installYear })
    .from(schema.customers)
    .innerJoin(schema.equipment, eq(schema.equipment.customerId, schema.customers.id))
    .where(and(inArray(schema.equipment.kind, kind), lt(schema.equipment.installYear, new Date().getFullYear() - 8)))
    .orderBy(schema.equipment.installYear)
  const ids = [...new Set(rows.map((r) => r.id))].slice(0, 40)
  const temp = trigger === 'cold_snap' ? `lows near ${cToF(minC)}°F` : `highs near ${cToF(maxC)}°F`
  let copy = {
    subject: trigger === 'cold_snap' ? 'Cold snap coming: is your furnace ready?' : 'Heat wave ahead: keep your AC running',
    body: `Hi {first_name}, forecasts show ${temp} this week. Systems over 8 years old are the most likely to fail when they're working hardest. Book a $89 safety check now and skip the emergency rush: reply to this email or call ${s.company.phone}. — ${s.company.name}`,
  }
  if (aiEnabled()) {
    copy = await generateJson({
      run,
      name: 'campaign.copy',
      system: `You write short service-reminder emails for ${s.company.name}, a residential HVAC & plumbing company. Use {first_name} as placeholder. Offer a $89 safety check. Phone: ${s.company.phone}.`,
      prompt: `Trigger: ${trigger}, ${temp}. Audience: ${ids.length} customers with ${kind.join('/')} older than 8 years.`,
      schema: CampaignSchema,
    }).catch(() => copy)
  }
  const [camp] = await db
    .insert(schema.campaigns)
    .values({ trigger, title: `${trigger === 'cold_snap' ? 'Cold snap' : 'Heat wave'}: ${temp}`, subject: copy.subject, body: copy.body, customerIds: ids })
    .returning()
  const out = await act(run, {
    policy: 'send_campaign',
    tool: 'send_campaign',
    args: { campaignId: camp.id },
    summary: `Send "${copy.subject}" to ${ids.length} customers (${temp})`,
  })
  await run.end(out.status === 'done' ? 'done' : 'waiting_approval', `campaign #${camp.id} → ${out.status}`)
  return { trigger, campaignId: camp.id, audience: ids.length, minC, maxC }
}

registerExecutor('send_campaign', async (a) => {
  const [camp] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, Number(a.campaignId)))
  if (!camp || camp.status !== 'draft') return { skipped: true }
  const custs = await db
    .select()
    .from(schema.customers)
    .where(inArray(schema.customers.id, camp.customerIds.length ? camp.customerIds : [-1]))
  for (const c of custs) await messageCustomer({ customerId: c.id, subject: camp.subject, body: camp.body.replaceAll('{first_name}', firstName(c.name)) })
  await db.update(schema.campaigns).set({ status: 'sent', sentAt: new Date() }).where(eq(schema.campaigns.id, camp.id))
  await publish('campaign.sent', { campaignId: camp.id, recipients: custs.length })
  return { sent: custs.length }
})

export const CRON = { tick: watchdog, morning: morningPlan, weather: weatherScan } as const
export type CronName = keyof typeof CRON
