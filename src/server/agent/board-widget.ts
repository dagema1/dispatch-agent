import { deflateSync } from 'node:zlib'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { replan } from '../domain/dispatch'
import { ownerChatId } from '../domain/messaging'
import { type TgWidgetQuery, tg } from '../integrations/telegram'
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

export async function boardData(note?: string): Promise<string> {
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
  return packBoard({ d: day, at: short(new Date()), u: unassigned, a: pending, ...(note ? { n: note } : {}) }, rows)
}

async function stored(): Promise<{ chatId: string; messageId: number } | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY))
  return (row?.value as { chatId: string; messageId: number } | undefined) ?? null
}

/** Post the board to the office group and pin it. Returns why not when it can't. */
export async function postBoard(chatId?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const chat = chatId ?? (await ownerChatId())
  if (!chat) return { ok: false, reason: 'No office group yet. Add the bot to your group and send /owner there.' }
  try {
    const m = await tg<{ message_id: number }>('sendWidget', {
      chat_id: chat,
      html: BOARD_WIDGET_HTML,
      chat_data: await boardData(),
      allow_queries: true,
      caption: '📋 Live board · updates itself as the day changes. Tap a technician for their route.',
      disable_notification: true,
    })
    const value = { chatId: chat, messageId: m.message_id }
    await db.insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    await tg('pinChatMessage', { chat_id: chat, message_id: m.message_id, disable_notification: true }).catch(() => {})
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `Telegram refused the widget: ${(e as Error).message.slice(0, 160)}` }
  }
}

export async function refreshBoard(note?: string) {
  const b = await stored()
  if (!b) return
  await tg('editMessageWidgetData', { chat_id: b.chatId, message_id: b.messageId, chat_data: await boardData(note) }).catch(async (e) => {
    const msg = (e as Error).message
    console.warn('[telegram] board refresh', msg)
    // deleted or too old to edit: forget it, /menu or Settings posts a new one
    if (/not found|can't be edited|MESSAGE_ID_INVALID/i.test(msg)) await db.delete(schema.settings).where(eq(schema.settings.key, KEY))
  })
}

/** Taps on the board. Answered within 15 s; a re-plan runs afterwards and the board refreshes itself. */
export async function onBoardQuery(q: TgWidgetQuery) {
  const answer = (data: string) => tg('answerWidgetQuery', { widget_query_id: q.id, data: data.slice(0, 1000) }).catch((e) => console.warn('[telegram] board answer', e.message))
  const [verb, arg] = q.data.split(':')
  if (verb === 'replan') {
    void replan({ reason: `re-plan from the office board (${q.from.first_name ?? 'office'})` })
      .then((r) => refreshBoard(`Re-planned: ${r.moved.length} visit(s) changed`))
      .catch((e) => console.error('[replan]', e))
    return answer('Re-planning… the board updates when it’s done.')
  }
  if (verb === 't') {
    const id = Number(arg)
    const [t] = await db.select().from(schema.technicians).where(eq(schema.technicians.id, id))
    if (!t) return answer('Technician not found.')
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
    if (!rows.length) return answer(`${t.name}: nothing on the route today.`)
    const icon: Record<string, string> = { scheduled: '·', en_route: '🚐', on_site: '🔧', done: '✅' }
    return answer(
      `${t.name}\n${rows.map((r) => `${icon[r.j.status] ?? '·'} ${short(r.j.scheduledStart)} #${r.j.id}${r.j.priority === 1 ? ' 🚨' : ''} ${r.j.title} (${r.c.split(' ')[0]})`).join('\n')}`,
    )
  }
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
