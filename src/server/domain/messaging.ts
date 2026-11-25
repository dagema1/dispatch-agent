import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { publish } from '../lib/bus'
import { env } from '../lib/env'
import { gmailConnected, sendGmail } from '../integrations/google'
import { esc, sendTelegram } from '../integrations/telegram'

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
  channel?: 'email' | 'voice' | 'web'
}) {
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, opts.customerId))
  if (!c) throw new Error('customer not found')
  let delivered = false
  if ((opts.channel ?? 'email') === 'email' && c.email && (await gmailConnected())) {
    try {
      await sendGmail({ to: c.email, subject: opts.subject, body: opts.body })
      delivered = true
    } catch (e) {
      console.warn('[gmail] send failed', (e as Error).message)
    }
  }
  const [m] = await db
    .insert(schema.messages)
    .values({
      customerId: c.id,
      requestId: opts.requestId ?? null,
      jobId: opts.jobId ?? null,
      direction: 'out',
      channel: opts.channel ?? 'email',
      subject: opts.subject,
      body: opts.body,
      delivered,
    })
    .returning()
  if (opts.requestId) {
    await db
      .update(schema.requests)
      .set({ firstResponseAt: new Date() })
      .where(eq(schema.requests.id, opts.requestId))
      .catch(() => {})
  }
  await publish('message.sent', { messageId: m.id, customerId: c.id, to: c.name, subject: opts.subject, delivered })
  return { messageId: m.id, delivered }
}

export async function messageTechnician(technicianId: number, text: string, jobId?: number) {
  const [t] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, technicianId))
  if (!t) throw new Error('technician not found')
  let delivered = false
  if (t.telegramChatId) delivered = await sendTelegram(t.telegramChatId, text)
  await db.insert(schema.messages).values({ technicianId, jobId: jobId ?? null, direction: 'out', channel: 'telegram', body: text, delivered })
  await publish('message.tech', { technicianId, name: t.name, delivered, preview: text.slice(0, 80) })
  return { delivered }
}

export async function ownerChatId(): Promise<string | null> {
  if (env.TELEGRAM_OWNER_CHAT_ID) return env.TELEGRAM_OWNER_CHAT_ID
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'telegram_owner'))
  return (row?.value as { chatId?: string } | undefined)?.chatId ?? null
}

/** Alert the office group. `replan` adds a one-tap "Re-plan now" button anyone in the group can press. */
export async function alertOwner(text: string, opts: { replan?: boolean } = {}) {
  const chat = await ownerChatId()
  const markup = opts.replan ? { reply_markup: { inline_keyboard: [[{ text: '🔁 Re-plan now', callback_data: 'replan' }]] } } : {}
  const ok = chat ? await sendTelegram(chat, `🔔 ${esc(text)}`, markup) : false
  await publish('owner.alert', { text, delivered: ok })
}

export const firstName = (n: string) => n.split(' ')[0]
