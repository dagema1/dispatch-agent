import { deflateSync } from 'node:zlib'

/**
 * Technician route as a Telegram HTML widget (Bot API 10.4). The widget is static HTML in a
 * sandbox with no network; it renders from `chat_data` (≤1024 bytes, JSON) and talks to the bot
 * only through `TelegramWidget.request(data)` (≤64 bytes). The bot answers the request and pushes
 * fresh `chat_data` with editMessageWidgetData, which fires `chatDataChanged` and re-renders.
 *
 * Compact row: [jobId, "9:30a", "title", "Customer", status s|e|o, priority, lat, lng]
 */
export type WidgetRow = [number, string, string, string, 's' | 'e' | 'o', number, number, number]
export type WidgetData = { d: string; j: WidgetRow[]; n?: string }

export function packRoute(day: string, rows: WidgetRow[], note?: string): string {
  const fit = (r: WidgetRow[], t: number): WidgetRow[] => r.map((x) => [x[0], x[1], x[2].slice(0, t), x[3].slice(0, 18), x[4], x[5], x[6], x[7]])
  for (const t of [40, 28, 18, 10]) {
    for (let n = rows.length; n > 0; n--) {
      const s = JSON.stringify({ d: day, j: fit(rows.slice(0, n), t), ...(note ? { n: note.slice(0, 80) } : {}) } satisfies WidgetData)
      if (Buffer.byteLength(s) <= 1024) return s
    }
  }
  return JSON.stringify({ d: day, j: [] })
}

export const ROUTE_WIDGET_HTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>
:root{--bg:#fff;--fg:#111;--mut:#6b7280;--line:#e5e7eb;--acc:#2f5bd3;--ok:#059669;--warn:#d97706;--bad:#dc2626}
.dark{--bg:#17181c;--fg:#f3f4f6;--mut:#9ca3af;--line:#2a2d35;--acc:#6f93ff}
*{box-sizing:border-box}body{margin:0;font:14px/1.35 system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px 6px}h1{font-size:15px;margin:0}small{color:var(--mut);font-size:12px}
ol{list-style:none;margin:0;padding:0 8px 8px}li{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:center;padding:9px 6px;border-top:1px solid var(--line)}
li:first-child{border-top:0}.t{font-weight:600;font-variant-numeric:tabular-nums}.ti{font-weight:500}.c{color:var(--mut);font-size:12px;cursor:pointer;text-decoration:underline dotted}
.p1 .t{color:var(--bad)}.p2 .t{color:var(--warn)}button{font:inherit;font-size:13px;font-weight:600;border:0;border-radius:10px;padding:8px 11px;background:var(--acc);color:#fff;min-width:86px}
button.e{background:var(--warn)}button.o{background:var(--ok)}button:disabled{opacity:.55}.st{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
#msg{margin:0 14px 12px;font-size:12px;color:var(--mut);min-height:16px}.empty{padding:18px 14px;color:var(--mut)}
</style><header><h1>Your route</h1><small id=day></small></header><ol id=list></ol><div id=msg></div><script>
var W=window.TelegramWidget,busy=false;
if(W&&W.colorScheme==='dark')document.documentElement.className='dark';
var L={s:['On my way','omw'],e:['Arrived','arr'],o:['Job done','done']},S={s:'booked',e:'en route',o:'on site'};
function data(){try{return JSON.parse((W&&W.chatData)||'{}')}catch(e){return{}}}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function render(){var d=data(),ol=document.getElementById('list');document.getElementById('day').textContent=d.d||'';ol.textContent='';
var j=d.j||[];if(!j.length){ol.appendChild(el('div','empty','No more jobs today. Nice work.'));}
j.forEach(function(r){var li=el('li','p'+r[5]);li.appendChild(el('div','t',r[1]));var m=el('div');m.appendChild(el('div','ti','#'+r[0]+' '+r[2]));
var c=el('div','c',r[3]+' · map');c.onclick=function(){W&&W.openLink('https://maps.google.com/?q='+r[6]+','+r[7])};m.appendChild(c);li.appendChild(m);
var a=L[r[4]],b=el('button',r[4],a[0]);b.onclick=function(){send(a[1]+':'+r[0],b)};var w=el('div');w.style.textAlign='right';w.appendChild(b);w.appendChild(el('div','st',S[r[4]]));li.appendChild(w);ol.appendChild(li)});
if(d.n)say(d.n)}
function say(t){document.getElementById('msg').textContent=t}
function send(q,b){if(!W){say('Open in Telegram to use the buttons.');return}if(busy)return;busy=true;b.disabled=true;say('Working…');
W.request(q).then(function(a){busy=false;b.disabled=false;say((a&&a.result)||'Done.');if(W.HapticFeedback)W.HapticFeedback.notificationOccurred('success')},
function(e){busy=false;b.disabled=false;say(e&&e.code==='RATE_LIMITED'?'Slow down a little and try again.':'Could not reach the office ('+(e&&e.code)+'). Use the /commands instead.')})}
if(W){W.onEvent('chatDataChanged',render);if(W.ready)W.ready()}render();
</script>`

/** Telegram limit: ≤32768 bytes raw and ≤4096 bytes zlib-compressed at max level. */
export function widgetFits(html = ROUTE_WIDGET_HTML) {
  return Buffer.byteLength(html) <= 32768 && deflateSync(html, { level: 9 }).length <= 4096
}
