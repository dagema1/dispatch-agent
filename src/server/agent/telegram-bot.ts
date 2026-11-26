import { esc, sendTelegram, type TgUpdate } from '../integrations/telegram'
import { isBoardWidget, onBoardQuery, sendBoardDm } from './board-widget'
import { isOwnerChat, onGroupMessage, onOwnerCallback } from './owner-bot'
import { onTechCallback, onTechMessage, onWidgetQuery } from './technician'

/**
 * One bot, two audiences: technicians in private chats (route widget, status, voice notes) and the
 * office team in the owner group (approvals, ephemeral briefings, copilot).
 */
export async function onTelegramUpdate(u: TgUpdate) {
  try {
    // the office board lives in the owner group; route widgets live in technicians' private chats
    if (u.widget_query) {
      const q = u.widget_query
      const chat = q.chat?.id ?? q.from.id
      return (await isOwnerChat(chat)) || (await isBoardWidget(chat, q.message_id)) ? await onBoardQuery(q) : await onWidgetQuery(q)
    }
    if (u.callback_query) {
      const chat = u.callback_query.message?.chat
      return chat && chat.type !== 'private' ? await onOwnerCallback(u.callback_query) : await onTechCallback(u.callback_query)
    }
    const msg = u.message ?? u.edited_message
    if (!msg) return
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') return await onGroupMessage(msg)
    // an office member asking for the live board widget in their private chat
    if (msg.from && /^\/board(@\w+)?$/.test((msg.text ?? '').trim())) {
      const r = await sendBoardDm(msg.from.id)
      if (!r.ok) await sendTelegram(String(msg.chat.id), esc(r.reason))
      return
    }
    return await onTechMessage(msg)
  } catch (e) {
    console.error('[telegram] handler', e)
    const msg = u.message
    if (msg && !msg.location && (msg.chat.type === 'private' || (await isOwnerChat(msg.chat.id))))
      await sendTelegram(String(msg.chat.id), `⚠️ Sorry, that didn't go through (${esc((e as Error).message.slice(0, 120))}).`).catch(() => {})
  }
}
