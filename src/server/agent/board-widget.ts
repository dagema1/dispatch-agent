import { deflateSync } from 'node:zlib'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { ownerChatId } from '../domain/messaging'
import { esc, type InlineKeyboard, type TgWidgetQuery, tg } from '../integrations/telegram'
import { subscribe } from '../lib/bus'
import { dayOf, fmtTime } from '../lib/time'

/**
 * The office group's live board as a Telegram HTML widget (Bot API 10.4): one pinned message with
 * every technician's day (done / total, what they're doing now or next) plus unassigned visits
 * and pending approvals. It re-renders in place (editMessageWidgetData) whenever the schedule or
 * a visit changes. Tapping a technician shows their route; "Re-plan" re-plans the day.
 *
 * chat_data ≤1024 bytes. Technician row: [techId, "Ana", "2f5bd3", done, total, now, "9:30a", "title"]
 * now: o on site · e en route · s next visit booked · f finished for the day · - nothing today
 */
export type BoardRow = [number, string, string, number, number, 'o' | 'e' | 's' | 'f' | '-', string, string]
export type BoardData = { d: string; at: string; u: number; a: number; t: BoardRow[]; n?: string }

const KEY = 'telegram_board'

export function packBoard(b: Omit<BoardData, 't'>, rows: BoardRow[]): string {
  const trimRows = (r: BoardRow[], t: number): BoardRow[] => r.map((x) => [x[0], x[1].slice(0, 14), x[2], x[3], x[4], x[5], x[6], x[7].slice(0, t)])
  for (const t of [30, 20, 12, 0]) {
    for (let n = rows.length; n > 0; n--) {
      const s = JSON.stringify({ ...b, ...(b.n ? { n: b.n.slice(0, 80) } : {}), t: trimRows(rows.slice(0, n), t) } satisfies BoardData)
      if (Buffer.byteLength(s) <= 1024) return s
    }
  }
  return JSON.stringify({ ...b, t: [] })
}

const short = (d: Date | null) =>
  d
    ? fmtTime(d)
        .replace(':00', '')
        .replace(/\s?([AP])M/i, (_, x: string) => x.toLowerCase())
    : ''

export type Snapshot = { day: string; at: string; unassigned: number; pending: number; rows: BoardRow[] }

/** Today across the fleet: one row per active technician, plus what's waiting on the office. */
async function snapshot(): Promise<Snapshot> {
  const today = dayOf(new Date())
  const techs = await db.select().from(schema.technicians).where(eq(schema.technicians.active, true))
  const jobs = (
    await db
      .select()
      .from(schema.jobs)
      .where(inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site', 'done']))
  ).filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === today)
  const unassigned = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.status, 'unassigned'))).length
  const pending = (await db.select({ id: schema.approvals.id }).from(schema.approvals).where(eq(schema.approvals.status, 'pending'))).length
  const rows: BoardRow[] = techs.map((t) => {
    const mine = jobs.filter((j) => j.technicianId === t.id).sort((a, b) => +a.scheduledStart! - +b.scheduledStart!)
    const done = mine.filter((j) => j.status === 'done').length
    const cur = mine.find((j) => j.status === 'on_site') ?? mine.find((j) => j.status === 'en_route') ?? mine.find((j) => j.status === 'scheduled')
    const now: BoardRow[5] = !mine.length ? '-' : !cur ? 'f' : cur.status === 'on_site' ? 'o' : cur.status === 'en_route' ? 'e' : 's'
    return [t.id, t.name.split(' ')[0], t.color.replace('#', ''), done, mine.length, now, cur ? short(cur.scheduledStart) : '', cur ? `#${cur.id} ${cur.title}` : '']
  })
  const day = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return { day, at: short(new Date()), unassigned, pending, rows }
}

export async function boardData(note?: string): Promise<string> {
  const s = await snapshot()
  return packBoard({ d: s.day, at: s.at, u: s.unassigned, a: s.pending, ...(note ? { n: note } : {}) }, s.rows)
}

const NOW: Record<BoardRow[5], string> = { o: '🔧 On site', e: '🚐 On the way', s: '⏭ Next', f: '✅ Done for the day', '-': '— Nothing today' }

/** The same board as a text message, for groups (Telegram allows widgets only in private chats for now). */
export function boardText(s: Snapshot, note?: string): string {
  const total = s.rows.reduce((a, r) => a + r[4], 0)
  const done = s.rows.reduce((a, r) => a + r[3], 0)
  const flags = [`${done}/${total} visits done`, s.unassigned ? `⚠️ ${s.unassigned} unassigned` : '', s.pending ? `🟡 ${s.pending} approval${s.pending > 1 ? 's' : ''}` : '']
    .filter(Boolean)
    .join(' · ')
  const lines = s.rows.map((r) => `<b>${esc(r[1])}</b> ${r[3]}/${r[4]} · ${NOW[r[5]]}${r[6] ? ` ${r[6]}` : ''}${r[7] ? ` · ${esc(r[7])}` : ''}`)
  return [
    `📋 <b>Live board</b> · ${esc(s.day)} · updated ${s.at}`,
    flags,
    '',
    ...(lines.length ? lines : ['No technicians on today.']),
    ...(note ? ['', `<i>${esc(note)}</i>`] : []),
  ].join('\n')
}

const boardKeyboard = (s: Snapshot): InlineKeyboard => {
  const techs = s.rows.map((r) => ({ text: `🗺 ${r[1]}`, callback_data: `bd:t:${r[0]}` }))
  const rows: InlineKeyboard = []
  for (let i = 0; i < techs.length; i += 3) rows.push(techs.slice(i, i + 3))
  rows.push([{ text: '🔁 Re-plan', callback_data: 'replan' }])
  return rows
}

type Stored = { chatId: string; messageId: number; kind?: 'widget' | 'text' }

async function stored(): Promise<Stored | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY))
  return (row?.value as Stored | undefined) ?? null
}

/**
 * Post the board to the office group and pin it: the widget where Telegram allows it, else the
 * text board with buttons. Returns why not when neither works.
 */
export async function postBoard(chatId?: string): Promise<{ ok: true; kind: 'widget' | 'text' } | { ok: false; reason: string }> {
  const chat = chatId ?? (await ownerChatId())
  if (!chat) return { ok: false, reason: 'No office group yet. Add the bot to your group and send /owner there.' }
  let value: Stored | null = null
  try {
    const m = await tg<{ message_id: number }>('sendWidget', {
      chat_id: chat,
      html: BOARD_WIDGET_HTML,
      chat_data: await boardData(),
      allow_queries: true,
      caption: '📋 Live board · updates itself as the day changes. Tap a technician for their route.',
      disable_notification: true,
    })
    value = { chatId: chat, messageId: m.message_id, kind: 'widget' }
  } catch (e) {
    // production Telegram: widgets only in private chats (INPUT_MEDIA_WIDGET_NOT_ALLOWED in groups)
    console.warn('[telegram] board widget not allowed here, posting the text board:', (e as Error).message)
  }
  if (!value) {
    const s = await snapshot()
    try {
      const m = await tg<{ message_id: number }>('sendMessage', {
        chat_id: chat,
        text: boardText(s),
        parse_mode: 'HTML',
        disable_notification: true,
        reply_markup: { inline_keyboard: boardKeyboard(s) },
      })
      value = { chatId: chat, messageId: m.message_id, kind: 'text' }
    } catch (e) {
      return { ok: false, reason: `Telegram refused the board: ${(e as Error).message.slice(0, 160)}` }
    }
  }
  await db.insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } })
  await tg('pinChatMessage', { chat_id: chat, message_id: value.messageId, disable_notification: true }).catch(() => {})
  return { ok: true, kind: value.kind ?? 'widget' }
}

export async function refreshBoard(note?: string) {
  await refreshDmBoards(note).catch((e) => console.warn('[telegram] dm boards', (e as Error).message))
  const b = await stored()
  if (!b) return
  const edit =
    b.kind === 'text'
      ? snapshot().then((s) =>
          tg('editMessageText', {
            chat_id: b.chatId,
            message_id: b.messageId,
            text: boardText(s, note),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: boardKeyboard(s) },
          }),
        )
      : boardData(note).then((data) => tg('editMessageWidgetData', { chat_id: b.chatId, message_id: b.messageId, chat_data: data }))
  await edit.catch(async (e) => {
    const msg = (e as Error).message
    if (/not modified/i.test(msg)) return
    console.warn('[telegram] board refresh', msg)
    // deleted or too old to edit: forget it, /menu or Settings posts a new one
    if (/not found|can't be edited|MESSAGE_ID_INVALID/i.test(msg)) await db.delete(schema.settings).where(eq(schema.settings.key, KEY))
  })
}

/* ---------- the widget in office members' private chats ---------- */

const DM_KEY = 'telegram_board_dm'
type DmBoard = { chatId: string; messageId: number; kind?: 'widget' | 'text' }

async function dmBoards(): Promise<DmBoard[]> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, DM_KEY))
  return ((row?.value as { list?: DmBoard[] } | undefined)?.list ?? []).filter((b) => b?.chatId && b.messageId)
}
async function saveDmBoards(list: DmBoard[]) {
  const value = { list }
  await db.insert(schema.settings).values({ key: DM_KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } })
}

/** Is this widget message one of the office boards (as opposed to a technician's route)? */
export async function isBoardWidget(chatId: number | string, messageId?: number) {
  if (!messageId) return false
  return (await dmBoards()).some((b) => b.chatId === String(chatId) && b.messageId === messageId)
}

/**
 * Send the live board widget to an office member's private chat with the bot (widgets are
 * allowed there). Only members of the office group get it; one board per person, the newest.
 */
export async function sendBoardDm(userId: number): Promise<{ ok: true; kind: 'widget' | 'text' } | { ok: false; reason: string }> {
  const group = await ownerChatId()
  if (!group) return { ok: false, reason: 'No office group is set up yet.' }
  const member = await tg<{ status: string }>('getChatMember', { chat_id: group, user_id: userId }).catch(() => null)
  if (!member || !['creator', 'administrator', 'member', 'restricted'].includes(member.status)) return { ok: false, reason: 'The live board is for members of the office group.' }
  const caption = '📋 Live board · updates itself as the day changes. Tap a technician for their route.'
  const widget = (allowQueries: boolean) =>
    tg<{ message_id: number }>('sendWidget', { chat_id: userId, html: BOARD_WIDGET_HTML, chat_data: '', caption, ...(allowQueries ? { allow_queries: true } : {}) })
  let sent: DmBoard | null = null
  try {
    const data = await boardData()
    const m = await tg<{ message_id: number }>('sendWidget', { chat_id: userId, html: BOARD_WIDGET_HTML, chat_data: data, allow_queries: true, caption })
    sent = { chatId: String(userId), messageId: m.message_id, kind: 'widget' }
  } catch (e) {
    const msg = (e as Error).message
    if (/chat not found|initiate|blocked/i.test(msg)) return { ok: false, reason: 'Open a private chat with the bot and press Start, then try again.' }
    console.warn('[telegram] board widget refused in private chat:', msg)
    // narrow down what Telegram objects to, for the log; the person gets a working board either way
    if (/NOT_ALLOWED/i.test(msg))
      await widget(false)
        .then(async (m) => {
          console.warn('[telegram] a widget without queries was accepted; queries are what Telegram refuses')
          await tg('deleteMessage', { chat_id: userId, message_id: m.message_id }).catch(() => {})
        })
        .catch((e2) => console.warn('[telegram] a bare widget was refused too:', (e2 as Error).message))
  }
  if (!sent) {
    // Telegram would not take the widget: send the same live board as text, edited in place as the day changes
    const s = await snapshot()
    const m = await tg<{ message_id: number }>('sendMessage', {
      chat_id: userId,
      text: boardText(s),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: boardKeyboard(s) },
    })
    sent = { chatId: String(userId), messageId: m.message_id, kind: 'text' }
  }
  const list = (await dmBoards()).filter((b) => b.chatId !== String(userId))
  list.push(sent)
  await saveDmBoards(list)
  return { ok: true, kind: sent.kind ?? 'widget' }
}

async function refreshDmBoards(note?: string) {
  const list = await dmBoards()
  if (!list.length) return
  const data = await boardData(note)
  const s = list.some((b) => b.kind === 'text') ? await snapshot() : null
  const gone: string[] = []
  for (const b of list)
    await (b.kind === 'text' && s
      ? tg('editMessageText', { chat_id: b.chatId, message_id: b.messageId, text: boardText(s, note), parse_mode: 'HTML', reply_markup: { inline_keyboard: boardKeyboard(s) } })
      : tg('editMessageWidgetData', { chat_id: b.chatId, message_id: b.messageId, chat_data: data })
    ).catch((e) => {
      const msg = (e as Error).message
      if (/not modified/i.test(msg)) return
      console.warn('[telegram] dm board refresh', msg)
      if (/not found|can't be edited|MESSAGE_ID_INVALID|blocked/i.test(msg)) gone.push(b.chatId)
    })
  if (gone.length) await saveDmBoards(list.filter((b) => !gone.includes(b.chatId)))
}

/** Buttons on a text board in someone's private chat: a technician's route, or a re-plan. */
export async function onDmBoardCallback(cb: { id: string; data?: string; from: { first_name?: string }; message?: { chat: { id: number } } }) {
  const chatId = cb.message?.chat.id
  if (chatId == null) return
  const [kind, sub, id] = (cb.data ?? '').split(':')
  if (kind === 'bd' && sub === 't') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {})
    await tg('sendMessage', { chat_id: chatId, text: esc(await techRoute(Number(id))), parse_mode: 'HTML' })
    return
  }
  if (kind === 'replan') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Re-planning…' }).catch(() => {})
    const res = await replan({ reason: `re-plan requested by ${cb.from.first_name ?? 'owner'} in Telegram` })
    await refreshBoard()
    await tg('sendMessage', { chat_id: chatId, text: `🔁 Re-planned: ${res.moved.length} visit(s) moved, ${res.unassigned.length} still unassigned.` })
    return
  }
  await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {})
}

/** One technician's route today, as plain lines (widget answer or ephemeral reply). */
export async function techRoute(id: number): Promise<string> {
  const [t] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, id))
  if (!t) return 'Technician not found.'
  const today = dayOf(new Date())
  const rows = (
    await db
      .select({ j: schema.jobs, c: schema.customers.name })
      .from(schema.jobs)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.jobs.customerId))
      .where(and(eq(schema.jobs.technicianId, id), inArray(schema.jobs.status, ['scheduled', 'en_route', 'on_site', 'done'])))
  )
    .filter((r) => r.j.scheduledStart && dayOf(r.j.scheduledStart) === today)
    .sort((a, b) => +a.j.scheduledStart! - +b.j.scheduledStart!)
  if (!rows.length) return `${t.name}: nothing on the route today.`
  const icon: Record<string, string> = { scheduled: '·', en_route: '🚐', on_site: '🔧', done: '✅' }
  return `${t.name}\n${rows.map((r) => `${icon[r.j.status] ?? '·'} ${short(r.j.scheduledStart)} #${r.j.id}${r.j.priority === 1 ? ' 🚨' : ''} ${r.j.title} (${r.c.split(' ')[0]})`).join('\n')}`
}

/** Taps on the board widget. Answered within 15 s; a re-plan runs afterwards and the board refreshes itself. */
export async function onBoardQuery(q: TgWidgetQuery) {
  const answer = (data: string) => tg('answerWidgetQuery', { widget_query_id: q.id, data: data.slice(0, 1000) }).catch((e) => console.warn('[telegram] board answer', e.message))
  const [verb, arg] = q.data.split(':')
  if (verb === 'replan') {
    void replan({ reason: `re-plan from the office board (${q.from.first_name ?? 'office'})` })
      .then((r) => refreshBoard(`Re-planned: ${r.moved.length} visit(s) changed`))
      .catch((e) => console.error('[replan]', e))
    return answer('Re-planning… the board updates when it’s done.')
  }
  if (verb === 't') return answer(await techRoute(Number(arg)))
  return answer('Unknown action.')
}

// Anything that changes the day re-renders the board, batched so a re-plan is one edit.
const g = globalThis as unknown as { __boardSub?: boolean }
if (!g.__boardSub) {
  g.__boardSub = true
  let t: ReturnType<typeof setTimeout> | null = null
  const WATCH = /^(job\.|plan\.updated|approval\.|tech\.late|request\.created)/
  subscribe((ev) => {
    if (!WATCH.test(ev.type)) return
    if (t) clearTimeout(t)
    t = setTimeout(() => void refreshBoard().catch(() => {}), 2000)
  })
}

export const BOARD_WIDGET_HTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>
:root{--bg:#fff;--fg:#111;--mut:#6b7280;--line:#e5e7eb;--chip:#f3f4f6;--acc:#2f5bd3;--ok:#059669;--warn:#d97706;--bad:#dc2626}
.dark{--bg:#17181c;--fg:#f3f4f6;--mut:#9ca3af;--line:#2a2d35;--chip:#23252b;--acc:#6f93ff}
*{box-sizing:border-box}body{margin:0;font:14px/1.35 system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px 4px}h1{font-size:15px;margin:0}small{color:var(--mut);font-size:12px}
.chips{display:flex;gap:6px;flex-wrap:wrap;padding:4px 14px 8px}.chip{font-size:12px;padding:3px 9px;border-radius:99px;background:var(--chip);color:var(--mut)}
.chip.w{background:rgba(217,119,6,.15);color:var(--warn);font-weight:600}
ol{list-style:none;margin:0;padding:0 8px}li{display:grid;grid-template-columns:10px 1fr auto;gap:10px;align-items:center;padding:9px 6px;border-top:1px solid var(--line);cursor:pointer}
li:first-child{border-top:0}.dot{width:10px;height:10px;border-radius:99px}.nm{font-weight:600}.st{font-size:12px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.o .st{color:var(--ok)}.e .st{color:var(--acc)}.pg{font-size:12px;font-variant-numeric:tabular-nums;color:var(--mut);text-align:right}
.bar{width:54px;height:4px;border-radius:99px;background:var(--line);margin-top:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--ok)}
footer{display:flex;gap:8px;align-items:center;padding:8px 14px 12px}button{font:inherit;font-size:13px;font-weight:600;border:0;border-radius:10px;padding:8px 12px;background:var(--acc);color:#fff}
button:disabled{opacity:.55}#msg{flex:1;font-size:12px;color:var(--mut);white-space:pre-line}.empty{padding:16px 14px;color:var(--mut)}
</style><header><h1>Live board</h1><small id=day></small></header><div class=chips id=chips></div><ol id=list></ol><footer><button id=rp>Re-plan</button><div id=msg></div></footer><script>
var W=window.TelegramWidget,busy=false;
if(W&&W.colorScheme==='dark')document.documentElement.className='dark';
var N={o:'On site',e:'On the way',s:'Next',f:'Done for the day','-':'Nothing today'};
function data(){try{return JSON.parse((W&&W.chatData)||'{}')}catch(e){return{}}}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function chip(t,w){document.getElementById('chips').appendChild(el('span','chip'+(w?' w':''),t))}
function render(){var d=data(),ol=document.getElementById('list');document.getElementById('day').textContent=(d.d||'')+(d.at?' · '+d.at:'');
ol.textContent='';document.getElementById('chips').textContent='';
var t=d.t||[],tot=0,dn=0;t.forEach(function(r){tot+=r[4];dn+=r[3]});chip(dn+'/'+tot+' visits done');
if(d.u)chip(d.u+' unassigned',1);if(d.a)chip(d.a+' approval'+(d.a>1?'s':''),1);
if(!t.length)ol.appendChild(el('div','empty','No technicians on today.'));
t.forEach(function(r){var li=el('li',r[5]),dot=el('span','dot');dot.style.background='#'+r[2];li.appendChild(dot);
var m=el('div');m.appendChild(el('div','nm',r[1]));m.appendChild(el('div','st',N[r[5]]+(r[6]?' '+r[6]:'')+(r[7]?' · '+r[7]:'')));li.appendChild(m);
var p=el('div','pg',r[3]+'/'+r[4]),b=el('div','bar'),i=el('i');i.style.width=(r[4]?Math.round(100*r[3]/r[4]):0)+'%';b.appendChild(i);p.appendChild(b);li.appendChild(p);
li.onclick=function(){ask('t:'+r[0])};ol.appendChild(li)});if(d.n)say(d.n)}
function say(t){document.getElementById('msg').textContent=t}
function ask(q,b){if(!W){say('Open in Telegram to use this.');return}if(busy)return;busy=true;if(b)b.disabled=true;say('…');
W.request(q).then(function(a){busy=false;if(b)b.disabled=false;say((a&&a.result)||'Done.')},
function(e){busy=false;if(b)b.disabled=false;say(e&&e.code==='RATE_LIMITED'?'Slow down a little and try again.':'Could not reach the office ('+(e&&e.code)+').')})}
document.getElementById('rp').onclick=function(){ask('replan',this)};
if(W){W.onEvent('chatDataChanged',render);if(W.ready)W.ready()}render();
</script>`

/** Telegram limit: ≤32768 bytes raw and ≤4096 bytes zlib-compressed at max level. */
export const boardFits = () => Buffer.byteLength(BOARD_WIDGET_HTML) <= 32768 && deflateSync(BOARD_WIDGET_HTML, { level: 9 }).length <= 4096
