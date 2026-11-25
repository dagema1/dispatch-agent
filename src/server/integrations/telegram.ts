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

export type TgUpdate = {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
}
export type TgMessage = {
  message_id: number
  chat: { id: number; first_name?: string; username?: string }
  from?: { id: number; first_name?: string; username?: string }
  text?: string
  voice?: { file_id: string; duration: number; mime_type?: string }
  audio?: { file_id: string; mime_type?: string }
  location?: { latitude: number; longitude: number; live_period?: number }
  date: number
}

const g = globalThis as unknown as { __tgPolling?: boolean }

export function startTelegramPolling(onUpdate: (u: TgUpdate) => Promise<void>) {
  if (!env.TELEGRAM_BOT_TOKEN || g.__tgPolling) return
  g.__tgPolling = true
  let offset = 0
  const loop = async () => {
    try {
      await tg('deleteWebhook', {}).catch(() => {})
      await tg('setMyCommands', {
        commands: [
          { command: 'start', description: 'Link this chat to your technician profile' },
          { command: 'today', description: "Today's route" },
          { command: 'onmyway', description: 'Tell the customer you are on the way: /onmyway <job#>' },
          { command: 'arrived', description: 'Mark arrival: /arrived <job#>' },
          { command: 'late', description: 'Running late: /late <minutes>' },
          { command: 'done', description: 'Finish a job: /done <job#>, then send a voice note' },
        ],
      }).catch(() => {})
    } catch {}
    for (;;) {
      try {
        const updates = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'edited_message'] })
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
