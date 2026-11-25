import { esc, sendTelegram, type TgUpdate } from '../integrations/telegram'
import { isOwnerChat, onGroupMessage, onOwnerCallback } from './owner-bot'
import { onTechCallback, onTechMessage, onWidgetQuery } from './technician'

/**
 * One bot, two audiences: technicians in private chats (route widget, status, voice notes) and the
 * office team in the owner group (approvals, ephemeral briefings, copilot).
 */
export async function onTelegramUpdate(u: TgUpdate) {
  try {
    if (u.widget_query) return await onWidgetQuery(u.widget_query)
    if (u.callback_query) {
      const chat = u.callback_query.message?.chat
      return chat && chat.type !== 'private' ? await onOwnerCallback(u.callback_query) : await onTechCallback(u.callback_query)
    }
    const msg = u.message ?? u.edited_message
    if (!msg) return
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') return await onGroupMessage(msg)
    return await onTechMessage(msg)
  } catch (e) {
    console.error('[telegram] handler', e)
    const msg = u.message
    if (msg && !msg.location && (msg.chat.type === 'private' || (await isOwnerChat(msg.chat.id))))
      await sendTelegram(String(msg.chat.id), `⚠️ Sorry, that didn't go through (${esc((e as Error).message.slice(0, 120))}).`).catch(() => {})
  }
}
