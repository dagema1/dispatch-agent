import type { Content } from '@google/genai'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { firstName, ownerChatId } from '../domain/messaging'
import {
  answerCallback,
  ephemeralCallbackReply,
  esc,
  type InlineKeyboard,
  sendEphemeral,
  sendTelegram,
  setOwnerCommands,
  type TgCallback,
  type TgMessage,
  type TgUser,
  tg,
} from '../integrations/telegram'
import { subscribe } from '../lib/bus'
import { env } from '../lib/env'
import { dayOf, fmtTime } from '../lib/time'
import { decideApproval } from './policy'

/**
 * Owner/office group on Telegram, run from buttons. A pinned control panel (Brief, Board,
 * Approvals, Re-plan, Ask) answers with ephemeral messages (Bot API 10.2/10.4) that only the
 * member who tapped can see, so the shared chat stays clean. Approval cards carry Approve /
 * Reject buttons and are edited to show who decided. "Ask" opens a reply prompt for a typed
 * question. Typed commands still work. Only the configured owner chat is honoured.
 */
const g = globalThis as unknown as {
  __apCards?: Map<number, number>
  __ownerSub?: boolean
  __askHist?: Map<number, Content[]>
  __askPrompts?: Map<number, number>
  __panel?: { chatId: string; messageId: number }
}
const cards = (g.__apCards ??= new Map()) // approvalId -> message_id in the owner group
const askHistory = (g.__askHist ??= new Map()) // telegram user -> copilot history
const askPrompts = (g.__askPrompts ??= new Map()) // prompt message_id -> user who asked for it

const who = (u: TgUser) => esc(u.first_name ?? u.username ?? 'someone')
const dashboardButton = (): InlineKeyboard => (env.APP_URL.startsWith('https://') ? [[{ text: 'Open dashboard', url: `${env.APP_URL}/app` }]] : [])

export async function isOwnerChat(chatId: number | string) {
  const owner = await ownerChatId()
  return owner != null && String(chatId) === String(owner)
}

export async function onOwnerReady() {
  const chat = await ownerChatId()
  if (!chat) return
  for (let i = 0; i < 3; i++) {
    if (await setOwnerCommands(chat)) return
    await new Promise((r) => setTimeout(r, 10_000))
  }
}

/** Group messages. With privacy mode on, the bot only receives commands here. */
export async function onGroupMessage(msg: TgMessage) {
  const chatId = String(msg.chat.id)
  const text = (msg.text ?? '').trim()
  const [raw, ...rest] = text.split(/\s+/)
  const cmd = raw?.split('@')[0]
  if (cmd === '/owner') {
    await db
      .insert(schema.settings)
      .values({ key: 'telegram_owner', value: { chatId } })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: { chatId } } })
    await setOwnerCommands(chatId)
    await sendTelegram(
      chatId,
      `✅ <b>${esc(msg.chat.title ?? 'This chat')}</b> is now the office channel: emergencies, approvals and escalations land here, and anyone in the group can act on them.${env.TELEGRAM_OWNER_CHAT_ID && env.TELEGRAM_OWNER_CHAT_ID !== chatId ? '\n\n⚠️ TELEGRAM_OWNER_CHAT_ID in .env points to a different chat and takes precedence.' : ''}`,
    )
    return postPanel(chatId)
  }
  if (!(await isOwnerChat(chatId)) || !msg.from) return
  // a reply to an "Ask the copilot" prompt is the question
  const prompt = msg.reply_to_message?.message_id
  if (prompt && askPrompts.get(prompt) === msg.from.id) {
    askPrompts.delete(prompt)
    await tg('deleteMessage', { chat_id: chatId, message_id: prompt }).catch(() => {})
    return answerAsk(chatId, msg.from.id, text, msg)
  }
  if (cmd === '/menu' || cmd === '/start') return postPanel(chatId)
  const say = (t: string, keyboard?: InlineKeyboard) => sendEphemeral(chatId, msg.from!.id, t, { replyTo: msg, keyboard })
  switch (cmd) {
    case '/brief':
      return say(await brief())
    case '/board':
      return say(await board())
    case '/approvals': {
      const pending = await db.select().from(schema.approvals).where(eq(schema.approvals.status, 'pending')).orderBy(asc(schema.approvals.createdAt))
      if (!pending.length) return say('Nothing waiting for a decision. ✅')
      for (const a of pending.slice(0, 8)) await say(approvalText(a), approvalKeyboard(a.id))
      return
    }
    case '/ask': {
      const q = rest.join(' ').trim()
      if (!q) return askPrompt(chatId, msg.from)
      return answerAsk(chatId, msg.from.id, q, msg)
    }
    case '/help':
    case '/start':
      return say(
        [
          '<b>Office channel</b> · use the pinned panel; answers are only visible to whoever tapped.',
          'Brief: today at a glance · Board: each technician’s route · Approvals: actions waiting for a decision',
          'Ask: the ops copilot (it can also re-plan, mark a tech out, or draft campaigns; risky actions still need approval)',
          '',
          'Approval cards posted here can be decided by anyone in the group; the card shows who decided. /menu re-posts the panel.',
        ].join('\n'),
      )
  }
}

/** Buttons in the owner group: approvals, details, re-plan. */
export async function onOwnerCallback(cb: TgCallback) {
  const chatId = cb.message?.chat.id
  if (chatId == null || !(await isOwnerChat(chatId))) return answerCallback(cb.id, 'Not allowed from this chat.', true)
  const [kind, idStr, verb] = (cb.data ?? '').split(':')
  if (kind === 'p') return onPanel(cb, chatId, idStr)
  if (kind === 'replan') {
    await answerCallback(cb.id, 'Re-planning…')
    const res = await replan({ reason: `re-plan requested by ${cb.from.first_name ?? 'owner'} in Telegram` })
    return ephemeralCallbackReply(cb.id, chatId, `🔁 Re-planned: ${res.moved.length} visit(s) moved, ${res.unassigned.length} still unassigned.`)
  }
  if (kind !== 'ap') return answerCallback(cb.id)
  const id = Number(idStr)
  const [ap] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id))
  if (!ap) return answerCallback(cb.id, 'Approval not found.', true)
  if (verb === 'd') {
    await answerCallback(cb.id)
    const body = typeof ap.args.body === 'string' ? `\n\n<blockquote expandable>${esc(ap.args.body).slice(0, 3000)}</blockquote>` : ''
    return ephemeralCallbackReply(cb.id, chatId, `<b>#${ap.id} ${esc(ap.summary)}</b>\nTool: <code>${esc(ap.tool)}</code>\nWhy held: ${esc(ap.reason ?? '')}${body}`)
  }
  if (ap.status !== 'pending') return answerCallback(cb.id, `Already ${ap.status}.`, true)
  const decision = verb === 'a' ? 'approved' : 'rejected'
  try {
    await decideApproval(id, decision)
  } catch (e) {
    return answerCallback(cb.id, `Failed: ${(e as Error).message}`.slice(0, 190), true)
  }
  await answerCallback(cb.id, decision === 'approved' ? 'Approved and executed.' : 'Rejected.')
  await markCard(cb.message!, ap, `${decision === 'approved' ? '✅ Approved' : '❌ Rejected'} by ${who(cb.from)}`)
}

async function markCard(m: TgMessage, ap: typeof schema.approvals.$inferSelect, line: string) {
  const text = `${approvalText(ap)}\n\n<b>${line}</b>`
  if (m.ephemeral_message_id && m.receiver_user) {
    return tg('editEphemeralMessageText', {
      chat_id: m.chat.id,
      receiver_user_id: m.receiver_user.id,
      ephemeral_message_id: m.ephemeral_message_id,
      text,
      parse_mode: 'HTML',
    }).catch(() => {})
  }
  return tg('editMessageText', { chat_id: m.chat.id, message_id: m.message_id, text, parse_mode: 'HTML' }).catch(() => {})
}

const approvalText = (a: typeof schema.approvals.$inferSelect) => `🟡 <b>Needs approval #${a.id}</b>\n${esc(a.summary)}\n<i>${esc(a.reason ?? '')}</i>`
const approvalKeyboard = (id: number): InlineKeyboard => [
  [
    { text: '✅ Approve', callback_data: `ap:${id}:a` },
    { text: '❌ Reject', callback_data: `ap:${id}:r` },
  ],
  [{ text: '🔎 Details (only you)', callback_data: `ap:${id}:d` }],
  ...dashboardButton(),
]

// Post a card for each new approval; when it's decided in the dashboard, update the card.
// The panel's Approvals button carries the live count.
if (!g.__ownerSub) {
  g.__ownerSub = true
  subscribe((ev) => {
    if (ev.type === 'approval.requested') void postCard(Number(ev.payload.approvalId)).then(refreshPanel)
    if (ev.type === 'approval.decided') void closeCard(Number(ev.payload.approvalId), String(ev.payload.decision)).then(refreshPanel)
  })
}

const pendingCount = async () => (await db.select({ id: schema.approvals.id }).from(schema.approvals).where(eq(schema.approvals.status, 'pending'))).length

const panelKeyboard = (pending: number): InlineKeyboard => [
  [
    { text: '📋 Today’s brief', callback_data: 'p:brief' },
    { text: '🗺 Board', callback_data: 'p:board' },
  ],
  [
    { text: pending ? `🟡 Approvals (${pending})` : '✅ Approvals', callback_data: 'p:aps' },
    { text: '🔁 Re-plan', callback_data: 'replan' },
  ],
  [{ text: '💬 Ask the copilot', callback_data: 'p:ask' }],
  ...dashboardButton(),
]
const PANEL_TEXT = '<b>Office panel</b>\nTap a button. Answers appear only for you, so the group stays clean.'

/** Post (and try to pin) the control panel. Pinning needs the bot to be an admin; it works without. */
async function postPanel(chatId: string) {
  const m = await tg<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: PANEL_TEXT,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: panelKeyboard(await pendingCount()) },
  }).catch((e) => {
    console.warn('[telegram] panel', e.message)
    return null
  })
  if (!m) return
  g.__panel = { chatId, messageId: m.message_id }
  await tg('pinChatMessage', { chat_id: chatId, message_id: m.message_id, disable_notification: true }).catch(() => {})
}

async function refreshPanel() {
  const p = g.__panel
  if (!p) return
  await tg('editMessageReplyMarkup', { chat_id: p.chatId, message_id: p.messageId, reply_markup: { inline_keyboard: panelKeyboard(await pendingCount()) } }).catch(() => {})
}

async function onPanel(cb: TgCallback, chatId: number, what: string) {
  const to = (t: string, keyboard?: InlineKeyboard) => sendEphemeral(String(chatId), cb.from.id, t, { keyboard })
  if (what === 'ask') {
    await answerCallback(cb.id)
    return askPrompt(String(chatId), cb.from)
  }
  await answerCallback(cb.id)
  if (what === 'brief') return to(await brief())
  if (what === 'board') return to(await board())
  if (what === 'aps') {
    const pending = await db.select().from(schema.approvals).where(eq(schema.approvals.status, 'pending')).orderBy(asc(schema.approvals.createdAt))
    if (!pending.length) return to('Nothing waiting for a decision. ✅')
    for (const a of pending.slice(0, 8)) await to(approvalText(a), approvalKeyboard(a.id))
  }
}

/**
 * Telegram has no text input on buttons, so "Ask" posts a reply prompt aimed at the tapper
 * (force_reply + selective). Their reply comes back here (privacy mode still delivers replies to
 * the bot); the prompt is removed and the answer is ephemeral.
 */
async function askPrompt(chatId: string, u: TgUser) {
  if (!env.GEMINI_API_KEY) return sendEphemeral(chatId, u.id, 'The copilot needs GEMINI_API_KEY.')
  const m = await tg<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: `<a href="tg://user?id=${u.id}">${who(u)}</a>, what should I ask the copilot? Reply to this message.`,
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'e.g. who can take an emergency at 3pm?' },
  }).catch(() => null)
  if (m) askPrompts.set(m.message_id, u.id)
}

async function answerAsk(chatId: string, userId: number, q: string, replyTo?: TgMessage) {
  if (!q) return
  if (!env.GEMINI_API_KEY) return sendEphemeral(chatId, userId, 'The copilot needs GEMINI_API_KEY.')
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
  const { ownerChat } = await import('./owner')
  const r = await ownerChat(askHistory.get(userId) ?? [], q)
  askHistory.set(userId, r.history.slice(-20))
  return sendEphemeral(chatId, userId, `<b>Q:</b> ${esc(q).slice(0, 300)}\n\n${esc(r.text).slice(0, 3600)}`, { replyTo })
}

async function postCard(id: number) {
  const chat = await ownerChatId()
  if (!chat || !env.TELEGRAM_BOT_TOKEN) return
  const [a] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id))
  if (!a) return
  const m = await tg<{ message_id: number }>('sendMessage', {
    chat_id: chat,
    text: approvalText(a),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: approvalKeyboard(id) },
  }).catch((e) => {
    console.warn('[telegram] approval card', e.message)
    return null
  })
  if (m) cards.set(id, m.message_id)
}

async function closeCard(id: number, decision: string) {
  const mid = cards.get(id)
  const chat = await ownerChatId()
  if (!mid || !chat) return
  cards.delete(id)
  const [a] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id))
  if (!a) return
  await tg('editMessageText', {
    chat_id: chat,
    message_id: mid,
    text: `${approvalText(a)}\n\n<b>${decision === 'approved' ? '✅ Approved' : '❌ Rejected'}</b>`,
    parse_mode: 'HTML',
  }).catch(() => {})
}

async function brief() {
  const today = dayOf(new Date())
  const [jobs, ap, inv, techs] = await Promise.all([
    db
      .select()
      .from(schema.jobs)
      .where(inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site', 'unassigned', 'done'])),
    db.select().from(schema.approvals).where(eq(schema.approvals.status, 'pending')),
    db.select().from(schema.invoices),
    db.select().from(schema.technicians).where(eq(schema.technicians.active, true)),
  ])
  const todays = jobs.filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === today)
  const done = todays.filter((j) => j.status === 'done').length
  const live = todays.filter((j) => j.status === 'en_route' || j.status === 'on_site').length
  const unassigned = jobs.filter((j) => j.status === 'unassigned')
  const p1 = todays.filter((j) => j.priority === 1 && j.status !== 'done').length
  const money = (c: number) => `$${Math.round(c / 100).toLocaleString()}`
  const unpaid = inv.filter((i) => i.status === 'sent')
  return [
    `<b>Today</b> · ${todays.length} visits, ${done} done, ${live} in progress, ${techs.length} techs on`,
    p1 ? `🚨 ${p1} open emergency visit(s)` : '✅ No open emergencies',
    unassigned.length
      ? `⚠️ ${unassigned.length} job(s) unassigned: ${unassigned
          .slice(0, 4)
          .map((j) => `#${j.id}`)
          .join(', ')}`
      : '✅ Everything is on a route',
    ap.length ? `🟡 ${ap.length} approval(s) waiting (tap Approvals)` : '✅ No approvals waiting',
    `💵 Collected ${money(inv.filter((i) => i.status === 'paid').reduce((a, i) => a + i.totalCents, 0))} · outstanding ${money(unpaid.reduce((a, i) => a + i.totalCents, 0))} on ${unpaid.length} invoice(s)`,
  ].join('\n')
}

async function board() {
  const today = dayOf(new Date())
  const rows = await db
    .select({ j: schema.jobs, c: schema.customers.name, t: schema.technicians.name })
    .from(schema.jobs)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
    .innerJoin(schema.technicians, eq(schema.technicians.id, schema.jobs.technicianId))
    .where(and(inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site', 'done'])))
    .orderBy(asc(schema.jobs.scheduledStart))
  const byTech = new Map<string, string[]>()
  const icon: Record<string, string> = { scheduled: '·', en_route: '🚐', on_site: '🔧', done: '✅' }
  for (const r of rows.filter((x) => x.j.scheduledStart && dayOf(x.j.scheduledStart) === today)) {
    const list = byTech.get(r.t) ?? []
    list.push(`${icon[r.j.status] ?? '·'} ${fmtTime(r.j.scheduledStart)} #${r.j.id}${r.j.priority === 1 ? ' 🚨' : ''} ${esc(r.j.title)} (${esc(firstName(r.c))})`)
    byTech.set(r.t, list)
  }
  if (!byTech.size) return 'No visits on the board today.'
  return [...byTech].map(([t, l]) => `<b>${esc(t)}</b>\n${l.join('\n')}`).join('\n\n')
}
