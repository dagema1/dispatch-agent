import { and, asc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { firstName, messageCustomer } from '../domain/messaging'
import { estimateMinutes } from '../integrations/routing'
import { answerCallback, downloadTelegramFile, esc, type InlineKeyboard, sendTelegram, type TgCallback, type TgMessage, type TgWidgetQuery, tg } from '../integrations/telegram'
import { publish, subscribe } from '../lib/bus'
import { links } from '../lib/links'
import { dayOf, fmtTime } from '../lib/time'
import { completeJobFromVoiceNote } from './revenue'
import { packRoute, ROUTE_WIDGET_HTML, type WidgetRow } from './route-widget'
import { Run } from './trace'

/**
 * Technician app on Telegram (private chats): route, status updates, live location and voice-note
 * job completion. The route is sent as an interactive HTML widget (Bot API 10.4) whose buttons call
 * the same actions as the slash commands; clients without widget support get inline buttons instead.
 */
const awaitingNote = new Map<number, number>() // chatId -> jobId
const g = globalThis as unknown as { __routeWidgets?: Map<number, { chatId: string; messageId: number }>; __routeSub?: boolean }
const widgets = (g.__routeWidgets ??= new Map()) // techId -> last route widget message

export async function onTechMessage(msg: TgMessage) {
  const chatId = String(msg.chat.id)
  const [tech] = await db.select().from(schema.technicians).where(eq(schema.technicians.telegramChatId, chatId))

  if (msg.location) return tech ? onLocation(tech.id, msg) : undefined
  const text = (msg.text ?? '').trim()
  if (!tech) return link(chatId, text)

  const [raw, arg] = text.split(/\s+/)
  const cmd = raw?.split('@')[0]
  const jobId = Number(arg?.replace('#', '')) || undefined
  switch (cmd) {
    case '/start':
    case '/today':
      return sendRoute(tech.id, chatId)
    case '/onmyway':
      return reply(chatId, await onMyWay(tech.id, jobId))
    case '/arrived':
      return reply(chatId, await arrived(tech.id, jobId))
    case '/late':
      return reply(chatId, await runningLate(tech.id, Number(arg) || 15))
    case '/done':
      return reply(chatId, await startDone(tech.id, msg.chat.id, jobId))
  }
  if (msg.voice || msg.audio || (text && awaitingNote.has(msg.chat.id))) {
    const jobId = awaitingNote.get(msg.chat.id)
    if (!jobId) return reply(chatId, 'Use /done <job#> first (or tap “Job done” on your route), then send the voice note.')
    awaitingNote.delete(msg.chat.id)
    await reply(chatId, '⏳ Writing the report and invoice…')
    let audio = null
    const file = msg.voice ?? msg.audio
    if (file) {
      const f = await downloadTelegramFile(file.file_id)
      audio = { mimeType: file.mime_type ?? 'audio/ogg', data: f.data.toString('base64') }
    }
    const res = await completeJobFromVoiceNote(jobId, audio, text || undefined)
    await reply(
      chatId,
      `✅ Job #${jobId} closed. Invoice #${res.invoiceId}: $${(res.totalCents / 100).toFixed(2)} (${res.status === 'done' ? 'sent to customer' : 'waiting for owner approval'}).\n${esc(res.report.workDone)}`,
    )
    afterChange(tech.id, `job #${jobId} completed`)
    return
  }
  return reply(chatId, 'Commands: /today, /onmyway <job#>, /arrived <job#>, /late <min>, /done <job#>. Share your live location so customers see an accurate ETA.')
}

/** Taps on the route widget. Must be answered within 15 s, so slow work (re-plan) runs afterwards. */
export async function onWidgetQuery(q: TgWidgetQuery) {
  const answer = (data: string) => tg('answerWidgetQuery', { widget_query_id: q.id, data: data.slice(0, 1000) }).catch((e) => console.warn('[telegram] widget answer', e.message))
  const [tech] = await db
    .select()
    .from(schema.technicians)
    .where(eq(schema.technicians.telegramChatId, String(q.chat?.id ?? q.from.id)))
  if (!tech) return answer('This route belongs to another technician.')
  try {
    return await answer(await runAction(tech.id, q.chat?.id ?? q.from.id, q.data))
  } catch (e) {
    return answer(`Didn't go through: ${(e as Error).message.slice(0, 120)}`)
  }
}

/** Fallback inline buttons on the text route. */
export async function onTechCallback(cb: TgCallback) {
  const chatId = cb.message?.chat.id ?? cb.from.id
  const [tech] = await db
    .select()
    .from(schema.technicians)
    .where(eq(schema.technicians.telegramChatId, String(chatId)))
  if (!tech) return answerCallback(cb.id, 'Not linked to a technician.')
  const text = await runAction(tech.id, chatId, cb.data ?? '')
  await answerCallback(cb.id, text.slice(0, 190))
  if (cb.data === 'route') return
  await reply(String(chatId), text)
}

async function runAction(techId: number, chatId: number, data: string): Promise<string> {
  const [verb, id] = data.split(':')
  const jobId = Number(id) || undefined
  if (verb === 'omw') return onMyWay(techId, jobId)
  if (verb === 'arr') return arrived(techId, jobId)
  if (verb === 'done') {
    const text = await startDone(techId, chatId, jobId)
    await reply(String(chatId), text)
    return 'Send the voice note in the chat below 🎙'
  }
  if (verb === 'route') {
    await sendRoute(techId, String(chatId))
    return 'Route refreshed.'
  }
  return 'Unknown action.'
}

async function link(chatId: string, text: string) {
  const techs = await db.select().from(schema.technicians)
  const name = text.replace('/start', '').trim().toLowerCase()
  const match = name ? techs.find((t) => t.name.toLowerCase().startsWith(name) || firstName(t.name).toLowerCase() === name) : null
  if (!match)
    return reply(
      chatId,
      `👋 Hi! Which technician are you? Reply with your first name: ${techs.map((t) => firstName(t.name)).join(', ')}.\n(Owner? Add me to your office group and send /owner there.)`,
    )
  await db.update(schema.technicians).set({ telegramChatId: chatId }).where(eq(schema.technicians.id, match.id))
  await publish('tech.linked', { technicianId: match.id, name: match.name })
  await reply(chatId, `✅ Linked to ${esc(match.name)}.`)
  return sendRoute(match.id, chatId)
}

async function todaysJobs(techId: number) {
  const today = dayOf(new Date())
  const jobs = await db
    .select({ job: schema.jobs, c: schema.customers })
    .from(schema.jobs)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
    .where(and(eq(schema.jobs.technicianId, techId), inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site'])))
    .orderBy(asc(schema.jobs.scheduledStart))
  return jobs.filter((j) => j.job.scheduledStart && dayOf(j.job.scheduledStart) === today)
}

const ST = { scheduled: 's', en_route: 'e', on_site: 'o' } as const
const shortTime = (d: Date | null) =>
  fmtTime(d)
    .replace(/:00/, '')
    .replace(/\s?([AP])M/i, (_, x: string) => x.toLowerCase())

async function routeData(techId: number, note?: string) {
  const jobs = await todaysJobs(techId)
  const rows: WidgetRow[] = jobs.map((j) => [
    j.job.id,
    shortTime(j.job.scheduledStart),
    j.job.title,
    j.c.name,
    ST[j.job.status as keyof typeof ST],
    j.job.priority,
    Math.round((j.c.lat ?? 0) * 1e4) / 1e4,
    Math.round((j.c.lng ?? 0) * 1e4) / 1e4,
  ])
  const day = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return { jobs, data: packRoute(day, rows, note) }
}

/** Send today's route: interactive widget first, text with inline buttons as the fallback. */
export async function sendRoute(techId: number, chatId: string) {
  const { jobs, data } = await routeData(techId)
  try {
    const m = await tg<{ message_id: number }>('sendWidget', {
      chat_id: chatId,
      html: ROUTE_WIDGET_HTML,
      chat_data: data,
      allow_queries: true,
      caption: jobs.length
        ? `🗺 ${jobs.length} visit(s) today. Tap a button as you go. Share live location (📎 → Location) for accurate ETAs.`
        : 'No more jobs on your route today. 🎉',
    })
    widgets.set(techId, { chatId, messageId: m.message_id })
    return
  } catch (e) {
    console.warn('[telegram] sendWidget failed, using text route:', (e as Error).message)
  }
  if (!jobs.length) return reply(chatId, 'No more jobs on your route today. 🎉')
  const lines = jobs.map(
    (j, i) =>
      `${i + 1}. <b>${fmtTime(j.job.scheduledStart)}</b> #${j.job.id} P${j.job.priority} ${esc(j.job.title)}\n   ${esc(j.c.name)}, <a href="https://maps.google.com/?q=${j.c.lat},${j.c.lng}">${esc(j.c.address)}</a>`,
  )
  const kb: InlineKeyboard = jobs.map((j) =>
    j.job.status === 'scheduled'
      ? [{ text: `🚐 #${j.job.id} On my way`, callback_data: `omw:${j.job.id}` }]
      : j.job.status === 'en_route'
        ? [{ text: `📍 #${j.job.id} Arrived`, callback_data: `arr:${j.job.id}` }]
        : [{ text: `✅ #${j.job.id} Job done`, callback_data: `done:${j.job.id}` }],
  )
  kb.push([{ text: '🔄 Refresh', callback_data: 'route' }])
  return sendTelegram(chatId, `🗺 <b>Your route today</b>\n\n${lines.join('\n\n')}\n\nShare live location (📎 → Location → Share live) for accurate ETAs.`, {
    reply_markup: { inline_keyboard: kb },
  })
}

/** Push fresh chat_data into the tech's last route widget (re-renders in place). */
async function refreshWidget(techId: number, note?: string) {
  const w = widgets.get(techId)
  if (!w) return
  const { data } = await routeData(techId, note)
  await tg('editMessageWidgetData', { chat_id: w.chatId, message_id: w.messageId, chat_data: data }).catch((e) => {
    console.warn('[telegram] widget refresh', e.message)
    widgets.delete(techId)
  })
}

// Office-side changes (re-plans, dashboard edits) keep every open route widget current.
if (!g.__routeSub) {
  g.__routeSub = true
  let t: ReturnType<typeof setTimeout> | null = null
  subscribe((ev) => {
    if (!['job.status', 'plan.updated', 'job.completed'].includes(ev.type) || !widgets.size) return
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      for (const id of widgets.keys()) void refreshWidget(id)
    }, 1500)
  })
}

/** Re-plan in the background after a tech action, then refresh their widget. */
function afterChange(techId: number, reason: string, note?: string) {
  void refreshWidget(techId, note)
  replan({ reason })
    .then(() => refreshWidget(techId, note))
    .catch((e) => console.error('[replan]', e))
}

async function pickJob(techId: number, jobId: number | undefined, statuses: string[]) {
  const rows = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.technicianId, techId), inArray(schema.jobs.status, statuses as never[]), jobId ? eq(schema.jobs.id, jobId) : sql`true`))
    .orderBy(asc(schema.jobs.scheduledStart))
  return rows[0] ?? null
}

async function onMyWay(techId: number, jobId?: number): Promise<string> {
  const job = await pickJob(techId, jobId, ['scheduled'])
  if (!job) return 'No upcoming job found.'
  const [tech] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, techId))
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
  const from = tech.liveLat != null ? { lat: tech.liveLat, lng: tech.liveLng! } : { lat: tech.homeLat, lng: tech.homeLng }
  const eta = new Date(Date.now() + estimateMinutes(from, { lat: c.lat!, lng: c.lng! }) * 60_000)
  const end = new Date(eta.getTime() + job.durationMin * 60_000)
  await claimNow(techId, job.id, { status: 'en_route', etaAt: eta, scheduledStart: new Date(), scheduledEnd: end })
  await publish('job.status', { jobId: job.id, status: 'en_route', eta: eta.toISOString() })
  await messageCustomer({
    customerId: c.id,
    jobId: job.id,
    subject: `${firstName(tech.name)} is on the way`,
    body: `Hi ${firstName(c.name)}, ${firstName(tech.name)} is on the way and should arrive around ${fmtTime(eta)}. Follow live: ${links.track(job.id)}`,
  })
  const text = `👍 ${firstName(c.name)} notified. ETA ${fmtTime(eta)}.`
  afterChange(techId, `tech ${firstName(tech.name)} en route`, text)
  return text
}

async function arrived(techId: number, jobId?: number): Promise<string> {
  const job = await pickJob(techId, jobId, ['en_route', 'scheduled'])
  if (!job) return 'Job not found.'
  await claimNow(techId, job.id, { status: 'on_site', scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + job.durationMin * 60_000) })
  await publish('job.status', { jobId: job.id, status: 'on_site' })
  const text = `📍 On site at #${job.id}. Tap “Job done” (or /done ${job.id}) when finished.`
  afterChange(techId, `tech on site at job #${job.id}`, text)
  return text
}

async function startDone(techId: number, chatId: number, jobId?: number): Promise<string> {
  const job = await pickJob(techId, jobId, ['on_site', 'en_route', 'scheduled'])
  if (!job) return 'No open job found. Use /done <job#>.'
  awaitingNote.set(chatId, job.id)
  return `🎙 Send a short voice note for job #${job.id}: what you did and which parts you used. I'll write the report and invoice.`
}

async function runningLate(techId: number, minutes: number): Promise<string> {
  const run = await Run.start('dispatch', 'tech_late', `+${minutes} min`)
  const job = await pickJob(techId, undefined, ['on_site', 'en_route'])
  if (job) {
    await db
      .update(schema.jobs)
      .set({ durationMin: job.durationMin + minutes, scheduledEnd: new Date((job.scheduledEnd ?? new Date()).getTime() + minutes * 60_000) })
      .where(eq(schema.jobs.id, job.id))
  } else {
    // not on a job yet: push the start of their day
    await db.update(schema.technicians).set({ liveAt: new Date() }).where(eq(schema.technicians.id, techId))
  }
  const res = await replan({ reason: `technician running ${minutes} min late`, run })
  await run.end('done', `re-planned: ${res.moved.length} visits moved`)
  void refreshWidget(techId)
  return `🔁 Re-planned. ${res.moved.length} visit(s) changed; affected customers are being notified.`
}

async function onLocation(techId: number, msg: TgMessage) {
  const { latitude: lat, longitude: lng } = msg.location!
  await db.update(schema.technicians).set({ liveLat: lat, liveLng: lng, liveAt: new Date() }).where(eq(schema.technicians.id, techId))
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.technicianId, techId), eq(schema.jobs.status, 'en_route')))
  let eta: string | undefined
  if (job) {
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
    const etaAt = new Date(Date.now() + estimateMinutes({ lat, lng }, { lat: c.lat!, lng: c.lng! }) * 60_000)
    await db.update(schema.jobs).set({ etaAt }).where(eq(schema.jobs.id, job.id))
    eta = etaAt.toISOString()
  }
  await publish('tech.location', { technicianId: techId, lat, lng, jobId: job?.id ?? null, eta })
}

/**
 * The tech is starting this job now. Set its real times and, in the same transaction, release any
 * later visit on their route that now overlaps (the re-plan that follows gives it a new slot and
 * tells the customer). Keeps the no-double-booking constraint satisfied at commit.
 */
async function claimNow(techId: number, jobId: number, set: Partial<typeof schema.jobs.$inferInsert> & { scheduledStart: Date; scheduledEnd: Date }) {
  await db.transaction(async (tx) => {
    await tx.update(schema.jobs).set(set).where(eq(schema.jobs.id, jobId))
    await tx
      .update(schema.jobs)
      .set({ status: 'unassigned', technicianId: null, sequence: null, etaAt: null })
      .where(
        and(
          eq(schema.jobs.technicianId, techId),
          eq(schema.jobs.status, 'scheduled'),
          ne(schema.jobs.id, jobId),
          lt(schema.jobs.scheduledStart, set.scheduledEnd),
          gt(schema.jobs.scheduledEnd, set.scheduledStart),
        ),
      )
  })
}

const reply = (chatId: string, text: string) => sendTelegram(chatId, text)
