import { inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { getSettings } from '../domain/settings'
import { esc, sendTelegram } from '../integrations/telegram'
import { type DomainEvent, subscribe } from '../lib/bus'
import { fmtDayTime, fmtTime } from '../lib/time'

/**
 * The office group's running log: every booking, assignment and slot change, and everything the
 * technicians are told or report (accepted, on the way, on site, notes, done). Lines that arrive
 * together (one re-plan moving five visits) go out as one silent message, so the group reads like
 * a dispatch log instead of buzzing on every change.
 */
const LOGGED = new Set(['job.booked', 'job.planned', 'job.accepted', 'job.status', 'tech.note', 'tech.late', 'job.completed', 'job.cancelled', 'message.tech'])
const BATCH_MS = 3000

type Job = typeof schema.jobs.$inferSelect

/** One log line per event; null when the event says nothing worth posting. */
export function logLine(ev: Pick<DomainEvent, 'type' | 'payload'>, jobs: Map<number, Job>, techs: Map<number, string>): string | null {
  const p = ev.payload
  const id = Number(p.jobId)
  const job = jobs.get(id)
  const ref = `<b>#${id}</b>${job ? ` ${esc(job.title)}` : ''}`
  const techName = (tid: unknown) => (tid != null ? (techs.get(Number(tid)) ?? null) : null)
  const who = (tid: unknown) => esc(techName(tid) ?? (job?.technicianId ? techName(job.technicianId) : null) ?? 'Technician')
  switch (ev.type) {
    case 'job.booked':
      return `🆕 Booked ${ref} · window ${fmtDayTime(String(p.windowStart))}–${fmtTime(String(p.windowEnd))}`
    case 'job.planned': {
      const tech = (p.tech as string | null) ?? null
      if (!p.to) return `⚠️ ${ref} has no slot now${tech ? ` (was ${esc(tech)})` : ''}`
      return p.from
        ? `🔁 ${ref} → ${esc(tech ?? 'unassigned')}, ${fmtDayTime(String(p.to))} (was ${fmtTime(String(p.from))})`
        : `🗓 ${ref} → ${esc(tech ?? 'unassigned')}, ${fmtDayTime(String(p.to))}`
    }
    case 'job.accepted':
      return `👍 ${p.name ? esc(String(p.name)) : who(p.technicianId)} accepted ${ref}`
    case 'job.status':
      if (p.status === 'en_route') return `🚗 ${who(null)} on the way to ${ref}${p.eta ? `, ETA ${fmtTime(String(p.eta))}` : ''}`
      if (p.status === 'on_site') return `📍 ${who(null)} on site at ${ref}`
      return `${ref} is now ${esc(String(p.status).replaceAll('_', ' '))}`
    case 'tech.note':
      return `📝 ${p.name ? esc(String(p.name)) : who(p.technicianId)} on ${ref}: ${esc(String(p.preview ?? ''))}`
    case 'tech.late':
      return `⏱ ${who(p.technicianId)} running ${Number(p.minutes)} min late${p.jobId ? ` at ${ref}` : ''}; day re-planned`
    case 'job.completed':
      return `✅ ${who(null)} finished ${ref}${p.totalCents != null ? ` · invoice $${(Number(p.totalCents) / 100).toFixed(0)}` : ''}`
    case 'job.cancelled':
      return `🚫 ${ref} cancelled`
    case 'message.tech': {
      // the technician's Telegram text is HTML; log a plain one-line preview of it
      const preview = String(p.preview ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      return `📨 To ${esc(String(p.name ?? 'technician'))}${p.delivered ? '' : ' (not delivered)'}: ${esc(preview)}`
    }
  }
  return null
}

let queue: DomainEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null

async function flush() {
  timer = null
  const evs = queue
  queue = []
  const settings = await getSettings()
  if (!settings.officeLog.telegram) return
  const { ownerChatId } = await import('../domain/messaging')
  const chat = await ownerChatId()
  if (!chat) return
  const jobIds = [...new Set(evs.map((e) => Number(e.payload.jobId)).filter((n) => Number.isFinite(n) && n > 0))]
  const jobs = new Map((jobIds.length ? await db.select().from(schema.jobs).where(inArray(schema.jobs.id, jobIds)) : []).map((j) => [j.id, j]))
  const techs = new Map((await db.select({ id: schema.technicians.id, name: schema.technicians.name }).from(schema.technicians)).map((t) => [t.id, t.name]))
  const lines = evs.map((e) => logLine(e, jobs, techs)).filter((l): l is string => !!l)
  if (!lines.length) return
  // Telegram caps a message at 4096 characters
  let text = lines.join('\n')
  if (text.length > 3900) text = `${text.slice(0, 3900)}\n…`
  await sendTelegram(chat, text, { disable_notification: true })
}

const g = globalThis as unknown as { __officeLog?: boolean }
if (!g.__officeLog) {
  g.__officeLog = true
  subscribe((ev) => {
    if (!LOGGED.has(ev.type)) return
    // loading the demo company plans the whole week at once: not news for the office
    if (ev.type === 'job.planned' && (ev.payload.reason === 'seed' || ev.payload.reason === 'fresh start')) return
    queue.push(ev)
    if (!timer) timer = setTimeout(() => void flush().catch((e) => console.warn('[office-log]', (e as Error).message)), BATCH_MS)
  })
}
