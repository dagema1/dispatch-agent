import { and, asc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { firstName, messageCustomer } from '../domain/messaging'
import { estimateMinutes } from '../integrations/routing'
import { downloadTelegramFile, sendTelegram, type TgMessage, type TgUpdate } from '../integrations/telegram'
import { publish } from '../lib/bus'
import { links } from '../lib/links'
import { dayOf, fmtTime } from '../lib/time'
import { completeJobFromVoiceNote } from './revenue'
import { Run } from './trace'

/** Technician app on Telegram: route, status updates, live location, and voice-note job completion. */
const awaitingNote = new Map<number, number>() // chatId -> jobId

export async function onTelegramUpdate(u: TgUpdate) {
  const msg = u.message ?? u.edited_message
  if (!msg) return
  try {
    return await handle(msg)
  } catch (e) {
    console.error('[telegram] handler', e)
    if (!msg.location) await reply(String(msg.chat.id), `⚠️ Sorry, that didn't go through (${(e as Error).message.slice(0, 120)}). The office has been notified.`).catch(() => {})
  }
}

async function handle(msg: TgMessage) {
  const chatId = String(msg.chat.id)
  const [tech] = await db.select().from(schema.technicians).where(eq(schema.technicians.telegramChatId, chatId))

  if (msg.location) return tech ? onLocation(tech.id, msg) : undefined
  const text = (msg.text ?? '').trim()

  if (text.startsWith('/owner')) {
    await db.insert(schema.settings).values({ key: 'telegram_owner', value: { chatId } }).onConflictDoUpdate({ target: schema.settings.key, set: { value: { chatId } } })
    return reply(chatId, '✅ This chat will receive owner alerts (emergencies, approvals, escalations).')
  }
  if (!tech) return link(chatId, text)

  const [cmd, arg] = text.split(/\s+/)
  const jobId = Number(arg?.replace('#', ''))
  switch (cmd) {
    case '/start':
    case '/today':
      return sendRoute(tech.id, chatId)
    case '/onmyway':
      return onMyWay(tech.id, chatId, jobId || undefined)
    case '/arrived':
      return setStatus(tech.id, chatId, jobId, 'on_site')
    case '/late':
      return runningLate(tech.id, chatId, Number(arg) || 15)
    case '/done': {
      const job = await pickJob(tech.id, jobId || undefined, ['on_site', 'en_route', 'scheduled'])
      if (!job) return reply(chatId, 'No open job found. Use /done <job#>.')
      awaitingNote.set(msg.chat.id, job.id)
      return reply(chatId, `🎙 Send a short voice note for job #${job.id}: what you did and which parts you used. I'll write the report and invoice.`)
    }
  }
  if (msg.voice || msg.audio || (text && awaitingNote.has(msg.chat.id))) {
    const jobId = awaitingNote.get(msg.chat.id)
    if (!jobId) return reply(chatId, 'Use /done <job#> first, then send the voice note.')
    awaitingNote.delete(msg.chat.id)
    await reply(chatId, '⏳ Writing the report and invoice…')
    let audio = null
    const file = msg.voice ?? msg.audio
    if (file) {
      const f = await downloadTelegramFile(file.file_id)
      audio = { mimeType: file.mime_type ?? 'audio/ogg', data: f.data.toString('base64') }
    }
    const res = await completeJobFromVoiceNote(jobId, audio, text || undefined)
    await reply(chatId, `✅ Job #${jobId} closed. Invoice #${res.invoiceId}: $${(res.totalCents / 100).toFixed(2)} (${res.status === 'done' ? 'sent to customer' : 'waiting for owner approval'}).\n${res.report.workDone}`)
    await replan({ reason: `job #${jobId} completed` }).catch((e) => console.error('[replan]', e))
    return
  }
  return reply(chatId, 'Commands: /today, /onmyway <job#>, /arrived <job#>, /late <min>, /done <job#>. Share your live location so customers see an accurate ETA.')
}

async function link(chatId: string, text: string) {
  const techs = await db.select().from(schema.technicians)
  const name = text.replace('/start', '').trim().toLowerCase()
  const match = name ? techs.find((t) => t.name.toLowerCase().startsWith(name) || firstName(t.name).toLowerCase() === name) : null
  if (!match) return reply(chatId, `👋 Hi! Which technician are you? Reply with your first name: ${techs.map((t) => firstName(t.name)).join(', ')}.\n(Owner? Send /owner)`)
  await db.update(schema.technicians).set({ telegramChatId: chatId }).where(eq(schema.technicians.id, match.id))
  await publish('tech.linked', { technicianId: match.id, name: match.name })
  await reply(chatId, `✅ Linked to ${match.name}.`)
  return sendRoute(match.id, chatId)
}

export async function sendRoute(techId: number, chatId: string) {
  const today = dayOf(new Date())
  const jobs = await db
    .select({ job: schema.jobs, c: schema.customers })
    .from(schema.jobs)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
    .where(and(eq(schema.jobs.technicianId, techId), inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site'])))
    .orderBy(asc(schema.jobs.scheduledStart))
  const todays = jobs.filter((j) => j.job.scheduledStart && dayOf(j.job.scheduledStart) === today)
  if (!todays.length) return reply(chatId, 'No more jobs on your route today. 🎉')
  const lines = todays.map(
    (j, i) =>
      `${i + 1}. <b>${fmtTime(j.job.scheduledStart)}</b> #${j.job.id} P${j.job.priority} ${j.job.title}\n   ${j.c.name}, <a href="https://maps.google.com/?q=${j.c.lat},${j.c.lng}">${j.c.address}</a>`,
  )
  return reply(chatId, `🗺 <b>Your route today</b>\n\n${lines.join('\n\n')}\n\nShare live location (📎 → Location → Share live) for accurate ETAs.`)
}

async function pickJob(techId: number, jobId: number | undefined, statuses: string[]) {
  const rows = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.technicianId, techId), inArray(schema.jobs.status, statuses as never[]), jobId ? eq(schema.jobs.id, jobId) : sql`true`))
    .orderBy(asc(schema.jobs.scheduledStart))
  return rows[0] ?? null
}

async function onMyWay(techId: number, chatId: string, jobId?: number) {
  const job = await pickJob(techId, jobId, ['scheduled'])
  if (!job) return reply(chatId, 'No upcoming job found.')
  const [tech] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, techId))
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
  const from = tech.liveLat != null ? { lat: tech.liveLat, lng: tech.liveLng! } : { lat: tech.homeLat, lng: tech.homeLng }
  const eta = new Date(Date.now() + estimateMinutes(from, { lat: c.lat!, lng: c.lng! }) * 60_000)
  const end = new Date(eta.getTime() + job.durationMin * 60_000)
  await claimNow(techId, job.id, { status: 'en_route', etaAt: eta, scheduledStart: new Date(), scheduledEnd: end })
  await publish('job.status', { jobId: job.id, status: 'en_route', eta: eta.toISOString() })
  await messageCustomer({ customerId: c.id, jobId: job.id, subject: `${firstName(tech.name)} is on the way`, body: `Hi ${firstName(c.name)}, ${firstName(tech.name)} is on the way and should arrive around ${fmtTime(eta)}. Follow live: ${links.track(job.id)}` })
  await replan({ reason: `tech ${firstName(tech.name)} en route` })
  return reply(chatId, `👍 Customer notified. ETA ${fmtTime(eta)}.`)
}

async function setStatus(techId: number, chatId: string, jobId: number, status: 'on_site') {
  const job = await pickJob(techId, jobId || undefined, ['en_route', 'scheduled'])
  if (!job) return reply(chatId, 'Job not found.')
  await claimNow(techId, job.id, { status, scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + job.durationMin * 60_000) })
  await publish('job.status', { jobId: job.id, status })
  await reply(chatId, `📍 Marked on site for #${job.id}. Use /done ${job.id} when finished.`)
  await replan({ reason: `tech on site at job #${job.id}` }).catch((e) => console.error('[replan]', e))
}

async function runningLate(techId: number, chatId: string, minutes: number) {
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
  return reply(chatId, `🔁 Re-planned. ${res.moved.length} visit(s) changed; affected customers are being notified.`)
}

async function onLocation(techId: number, msg: TgMessage) {
  const { latitude: lat, longitude: lng } = msg.location!
  await db.update(schema.technicians).set({ liveLat: lat, liveLng: lng, liveAt: new Date() }).where(eq(schema.technicians.id, techId))
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.technicianId, techId), eq(schema.jobs.status, 'en_route')))
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
