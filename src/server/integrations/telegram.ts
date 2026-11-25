import { env } from '../lib/env'

/**
 * Telegram Bot API (technician app + owner alerts). Uses long polling, so it works on localhost
 * without a public webhook URL. Live location shares arrive as edited messages.
 */
const API = () => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`

export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 10_000),
  })
  const data = (await res.json()) as { ok: boolean; result: T; description?: string }
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`)
  return data.result
}

export async function sendTelegram(chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false
  try {
    await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    return true
  } catch (e) {
    console.warn('[telegram]', (e as Error).message)
    return false
  }
}

export async function downloadTelegramFile(fileId: string): Promise<{ data: Buffer; path: string }> {
  const f = await tg<{ file_path: string }>('getFile', { file_id: fileId })
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`)
  return { data: Buffer.from(await res.arrayBuffer()), path: f.file_path }
}

export const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export type TgUser = { id: number; first_name?: string; username?: string }
export type TgUpdate = {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  callback_query?: TgCallback
  widget_query?: TgWidgetQuery
}
export type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage }
/** Bot API 10.4: a tap inside an HTML widget we sent, carrying 1-64 bytes of data. Answer within 15 s. */
export type TgWidgetQuery = { id: string; from: TgUser; chat?: { id: number; type: string }; message_id?: number; data: string }
export type TgMessage = {
  message_id: number
  /** Bot API 10.2: set (and message_id is 0) for ephemeral messages / ephemeral commands in groups. */
  ephemeral_message_id?: number
  receiver_user?: TgUser
  chat: { id: number; type?: 'private' | 'group' | 'supergroup' | 'channel'; first_name?: string; username?: string; title?: string }
  from?: TgUser
  text?: string
  voice?: { file_id: string; duration: number; mime_type?: string }
  audio?: { file_id: string; mime_type?: string }
  location?: { latitude: number; longitude: number; live_period?: number }
  date: number
}

const g = globalThis as unknown as { __tgPolling?: boolean }

export function startTelegramPolling(onUpdate: (u: TgUpdate) => Promise<void>, onReady?: () => Promise<void>) {
  if (!env.TELEGRAM_BOT_TOKEN || g.__tgPolling) return
  g.__tgPolling = true
  let offset = 0
  const loop = async () => {
    try {
      await tg('deleteWebhook', {}).catch(() => {})
      await tg('setMyCommands', {
        scope: { type: 'all_private_chats' },
        commands: [
          { command: 'start', description: 'Link this chat to your technician profile' },
          { command: 'today', description: "Today's route" },
          { command: 'onmyway', description: 'Tell the customer you are on the way: /onmyway <job#>' },
          { command: 'arrived', description: 'Mark arrival: /arrived <job#>' },
          { command: 'late', description: 'Running late: /late <minutes>' },
          { command: 'done', description: 'Finish a job: /done <job#>, then send a voice note' },
        ],
      }).catch((e) => console.warn('[telegram] commands', e.message))
      await onReady?.()
    } catch {}
    for (;;) {
      try {
        const updates = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'edited_message', 'callback_query', 'widget_query'] })
        for (const u of updates) {
          offset = u.update_id + 1
          await onUpdate(u).catch((e) => console.error('[telegram] handler', e))
        }
      } catch (e) {
        console.warn('[telegram] poll', (e as Error).message)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }
  void loop()
}

/** Owner-group commands are ephemeral (Bot API 10.2): the command and the answer are only visible to the member who sent it. */
export async function setOwnerCommands(chatId: string): Promise<boolean> {
  return tg('setMyCommands', {
    scope: { type: 'chat', chat_id: chatId },
    commands: [
      { command: 'brief', description: 'Today at a glance (only you see it)', is_ephemeral: true },
      { command: 'board', description: "Each technician's route today", is_ephemeral: true },
      { command: 'approvals', description: 'Actions waiting for a decision', is_ephemeral: true },
      { command: 'ask', description: 'Ask the ops copilot: /ask who is free at 3pm?', is_ephemeral: true },
      { command: 'help', description: 'What this bot does here', is_ephemeral: true },
    ],
  })
    .then(() => true)
    .catch((e) => {
      console.warn('[telegram] owner commands', (e as Error).message)
      return false
    })
}

/** Private answer inside a group: only `userId` sees it. Replies to the triggering (possibly ephemeral) message. */
export async function sendEphemeral(chatId: string, userId: number, text: string, opts: { replyTo?: TgMessage; keyboard?: InlineKeyboard } = {}) {
  const reply_parameters = opts.replyTo
    ? opts.replyTo.ephemeral_message_id
      ? { ephemeral_message_id: opts.replyTo.ephemeral_message_id, allow_sending_without_reply: true }
      : opts.replyTo.message_id
        ? { message_id: opts.replyTo.message_id, allow_sending_without_reply: true }
        : undefined
    : undefined
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ephemeral_message_parameters: { receiver_user_id: userId },
    ...(reply_parameters ? { reply_parameters } : {}),
    ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}),
  })
}

/** Bot API 10.4: answer a button press with a message only the presser sees (any chat type). */
export async function ephemeralCallbackReply(callbackQueryId: string, chatId: number | string, text: string) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ephemeral_message_parameters: { callback_query_id: callbackQueryId },
  })
}

export const answerCallback = (id: string, text?: string, alert = false) => tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }).catch(() => {})

export type InlineKeyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>
