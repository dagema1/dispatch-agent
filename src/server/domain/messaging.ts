import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { gmailConnected, sendGmail } from '../integrations/google'
import { esc, onChatMigrated, sendTelegram } from '../integrations/telegram'
import { publish } from '../lib/bus'
import { env } from '../lib/env'
import { personalize } from './persona'
import { getSettings } from './settings'

/**
 * Outbound communication. Every message is stored (the inbox shows full history); delivery goes
 * through Gmail for customers and Telegram for technicians/owner when connected. If a channel is
 * not connected the message stays in the outbox, visible in the UI, so the demo never breaks.
 */
export async function messageCustomer(opts: {
  customerId: number
  requestId?: number | null
  jobId?: number | null
  subject: string
  body: string
  channel?: 'email' | 'sms' | 'voice' | 'web'
}) {
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, opts.customerId))
  if (!c) throw new Error('customer not found')
  // the persona's salutation and sign-off apply to every customer message, whichever agent wrote it
  const settings = await getSettings()
  opts = { ...opts, body: personalize(opts.body, c.name, settings.persona) }
  // email when we have an address, a text when we only have a phone number
  const channel = sendable(opts.channel, c)
  const { delivered, via } = await tryDeliver(c, channel, opts.subject, opts.body)
  const [m] = await db
    .insert(schema.messages)
    .values({
      customerId: c.id,
      requestId: opts.requestId ?? null,
      jobId: opts.jobId ?? null,
      direction: 'out',
      channel,
      subject: channel === 'sms' ? null : opts.subject,
      body: opts.body,
      delivered,
      via,
    })
    .returning()
  if (opts.requestId) {
    await db
      .update(schema.requests)
      .set({ firstResponseAt: new Date() })
      .where(eq(schema.requests.id, opts.requestId))
      .catch(() => {})
  }
  await publish('message.sent', { messageId: m.id, customerId: c.id, to: c.name, subject: opts.subject, channel, delivered, via })
  return { messageId: m.id, delivered, via }
}

type Customer = typeof schema.customers.$inferSelect

/** A reply to a call or web form still has to go somewhere: email when we have an address, else a text. */
const sendable = (asked: string | null | undefined, c: Customer) => (asked === 'email' || asked === 'sms' ? asked : c.email ? 'email' : c.phone ? 'sms' : 'email')

/** One delivery attempt over whatever is connected: Gmail for email, else the demo's test inbox. */
async function tryDeliver(c: Customer, channel: string, subject: string, body: string): Promise<{ delivered: boolean; via: 'gmail' | 'test' | null }> {
  if (channel === 'email' && c.email && (await gmailConnected())) {
    try {
      await sendGmail({ to: c.email, subject, body })
      return { delivered: true, via: 'gmail' }
    } catch (e) {
      console.warn('[gmail] send failed', (e as Error).message)
    }
  }
  // no real channel: the demo's test inbox receives it (Simulators → Email & texts), and says so
  const settings = await getSettings()
  if (settings.sandbox.testInbox && ((channel === 'email' && c.email) || (channel === 'sms' && c.phone))) return { delivered: true, via: 'test' }
  return { delivered: false, via: null }
}

/** Try an undelivered customer message again, as it was written. */
export async function retryMessage(messageId: number) {
  const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId))
  if (!m?.customerId || m.direction !== 'out') throw new Error('not a customer message')
  if (m.delivered) return { delivered: true, via: m.via }
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, m.customerId))
  if (!c) throw new Error('customer not found')
  const channel = sendable(m.channel, c)
  const r = await tryDeliver(c, channel, m.subject ?? '', m.body)
  if (r.delivered) {
    await db.update(schema.messages).set({ delivered: true, via: r.via, channel }).where(eq(schema.messages.id, m.id))
    await publish('message.sent', {
      messageId: m.id,
      customerId: c.id,
      to: c.name,
      subject: m.subject ?? m.body.slice(0, 60),
      channel,
      delivered: true,
      via: r.via,
      retry: true,
    })
  }
  return r
}

/** The owner reached the customer another way (a call, in person): the message counts as handled, marked as such. */
export async function markToldManually(messageIds: number[]) {
  for (const id of messageIds) {
    await db.update(schema.messages).set({ delivered: true, via: 'manual' }).where(eq(schema.messages.id, id))
  }
  await publish('message.handled', { count: messageIds.length })
  return { count: messageIds.length }
}

export async function messageTechnician(technicianId: number, text: string, jobId?: number) {
  const [t] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, technicianId))
  if (!t) throw new Error('technician not found')
  let delivered = false
  if (t.telegramChatId) delivered = await sendTelegram(t.telegramChatId, text)
  await db.insert(schema.messages).values({ technicianId, jobId: jobId ?? null, direction: 'out', channel: 'telegram', body: text, delivered, via: delivered ? 'telegram' : null })
  await publish('message.tech', { technicianId, name: t.name, delivered, preview: text.slice(0, 80), jobId: jobId ?? null })
  return { delivered }
}

export async function ownerChatId(): Promise<string | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'telegram_owner'))
  const saved = row?.value as { chatId?: string; migratedFrom?: string } | undefined
  // the group in .env was upgraded to a supergroup: use its new id until .env is updated
  if (env.TELEGRAM_OWNER_CHAT_ID && saved?.migratedFrom === env.TELEGRAM_OWNER_CHAT_ID && saved.chatId) return saved.chatId
  if (env.TELEGRAM_OWNER_CHAT_ID) return env.TELEGRAM_OWNER_CHAT_ID
  return saved?.chatId ?? null
}

onChatMigrated(async (from, to) => {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'telegram_owner'))
  const saved = row?.value as { chatId?: string } | undefined
  if (from !== env.TELEGRAM_OWNER_CHAT_ID && from !== saved?.chatId) return
  const value = { ...(saved ?? {}), chatId: to, migratedFrom: from }
  await db.insert(schema.settings).values({ key: 'telegram_owner', value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } })
  // the pinned board lived in the old chat; post a fresh one next time
  await db.delete(schema.settings).where(eq(schema.settings.key, 'telegram_board'))
  console.warn(`[telegram] office group moved to ${to}; set TELEGRAM_OWNER_CHAT_ID=${to} in .env to make it permanent`)
})

/** Alert the office group. `replan` adds a one-tap "Re-plan now" button anyone in the group can press. */
export async function alertOwner(text: string, opts: { replan?: boolean } = {}) {
  const chat = await ownerChatId()
  const markup = opts.replan ? { reply_markup: { inline_keyboard: [[{ text: '🔁 Re-plan now', callback_data: 'replan' }]] } } : {}
  const ok = chat ? await sendTelegram(chat, `🔔 ${esc(text)}`, markup) : false
  await publish('owner.alert', { text, delivered: ok })
}

export const firstName = (n: string) => n.split(' ')[0]
