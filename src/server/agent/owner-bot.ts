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
 * Owner/office group on Telegram. Anyone in the group can act: approval cards carry Approve /
 * Reject buttons (the card is edited to show who decided), and every command is ephemeral
 * (Bot API 10.2), so a manager asking "/brief" or "/ask …" gets an answer only they can see
 * instead of filling the shared chat. Only callbacks from the configured owner chat are honoured.
 */
const g = globalThis as unknown as { __apCards?: Map<number, number>; __ownerSub?: boolean; __askHist?: Map<number, Content[]> }
const cards = (g.__apCards ??= new Map()) // approvalId -> message_id in the owner group
const askHistory = (g.__askHist ??= new Map()) // telegram user -> copilot history

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
    return sendTelegram(
      chatId,
      `✅ <b>${esc(msg.chat.title ?? 'This chat')}</b> is now the office channel: emergencies, approvals and escalations land here, and anyone in the group can act on them.${env.TELEGRAM_OWNER_CHAT_ID && env.TELEGRAM_OWNER_CHAT_ID !== chatId ? '\n\n⚠️ TELEGRAM_OWNER_CHAT_ID in .env points to a different chat and takes precedence.' : ''}`,
    )
  }
  if (!(await isOwnerChat(chatId)) || !msg.from) return
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
      if (!q) return say('Ask me anything about the schedule or the business, e.g. <code>/ask who can take an emergency on Pearl St at 3pm?</code>')
      if (!env.GEMINI_API_KEY) return say('The copilot needs GEMINI_API_KEY.')
      await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
      const { ownerChat } = await import('./owner')
      const r = await ownerChat(askHistory.get(msg.from.id) ?? [], q)
      askHistory.set(msg.from.id, r.history.slice(-20))
      return say(esc(r.text).slice(0, 4000))
    }
    case '/menu':
    case '/help':
    case '/start':
      return say(
        [
          '<b>Office channel</b> · answers to these commands are only visible to you.',
          '/brief: today at a glance',
          '/board: each technician’s route',
          '/approvals: actions waiting for a decision',
          '/ask &lt;question&gt;: the ops copilot (it can also re-plan, mark a tech out, or draft campaigns; risky actions still need approval)',
          '',
          'Approval cards posted here can be decided by anyone in the group; the card shows who decided.',
        ].join('\n'),
      )
  }
}

/** Buttons in the owner group: approvals, details, re-plan. */
export async function onOwnerCallback(cb: TgCallback) {
  const chatId = cb.message?.chat.id
  if (chatId == null || !(await isOwnerChat(chatId))) return answerCallback(cb.id, 'Not allowed from this chat.', true)
  const [kind, idStr, verb] = (cb.data ?? '').split(':')
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
if (!g.__ownerSub) {
  g.__ownerSub = true
  subscribe((ev) => {
    if (ev.type === 'approval.requested') void postCard(Number(ev.payload.approvalId))
    if (ev.type === 'approval.decided') void closeCard(Number(ev.payload.approvalId), String(ev.payload.decision))
  })
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
    ap.length ? `🟡 ${ap.length} approval(s) waiting (/approvals)` : '✅ No approvals waiting',
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
