/**
 * The company's time zone (COMPANY_TZ on the server, America/Denver by default). The server reads it
 * from the environment and hands the same value to the browser in the page head, so the screen and
 * the agents always agree on "today" and opening hours.
 */
export function companyTz(): string {
  const fallback = 'America/Denver'
  const v = typeof window !== 'undefined' ? (window as { __COMPANY_TZ?: string }).__COMPANY_TZ : process.env.COMPANY_TZ?.trim()
  if (!v) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return v
  } catch {
    return fallback
  }
}
export const money = (cents: number | null | undefined, digits = 0) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
export const time = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: companyTz(),
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(d))
    : '—'
export const dayTime = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: companyTz(),
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(d))
    : '—'
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${day}T12:00:00Z`))
export const dayOf = (d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: companyTz() }).format(new Date(d))
export const minutesOfDay = (d: string | Date) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: companyTz(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(d))
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value)
}
export const ago = (d: string | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return `${Math.max(0, Math.round(s))}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
/** Only an emergency gets colour; the rest read as neutral text so the page stays calm. */
export const P_STYLE: Record<number, string> = {
  1: 'bg-destructive/12 text-destructive ring-1 ring-destructive/25',
  2: 'text-foreground ring-1 ring-border',
  3: 'text-muted-foreground ring-1 ring-border',
  4: 'text-muted-foreground ring-1 ring-border',
}
export const P_LABEL: Record<number, string> = {
  1: 'P1 Emergency',
  2: 'P2 Urgent',
  3: 'P3 Routine',
  4: 'P4 Planned',
}
/** Status pills are neutral; a small dot carries the meaning. good = settled, live = moving, attn = waiting on a person, bad = failed. */
export type Tone = 'good' | 'live' | 'attn' | 'bad' | 'none'
export const STATUS_TONE: Record<string, Tone> = {
  scheduled: 'live',
  en_route: 'live',
  on_site: 'live',
  sent: 'live',
  triaged: 'live',
  running: 'live',
  done: 'good',
  paid: 'good',
  approved: 'good',
  accepted: 'good',
  booked: 'good',
  pending: 'attn',
  waiting_approval: 'attn',
  awaiting_customer: 'attn',
  unassigned: 'attn',
  failed: 'bad',
  escalated: 'bad',
}
export const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  live: 'bg-primary',
  attn: 'bg-(--attn-2)',
  bad: 'bg-destructive',
  none: 'bg-muted-foreground/50',
}
export const AGENT_LABEL: Record<string, string> = {
  front_desk: 'Front desk',
  diagnosis: 'Diagnosis',
  dispatch: 'Dispatch',
  revenue: 'Revenue',
  ops: 'Ops',
}
/** What started a run, in the owner's words. */
const TRIGGER_LABEL: Record<string, string> = {
  email: 'Email',
  voice: 'Phone call',
  web: 'Web form',
  photos: 'Customer photos',
  owner_chat: 'Your chat',
  cron_morning: 'Morning plan',
  cron_weather: 'Weather check',
  tech_late: 'Tech running late',
  tech_voice_note: 'Tech voice note',
  evals: 'Accuracy check',
}
/** What a step did, in plain words. Unknown names fall back to sentence case. */
const STEP_LABEL: Record<string, string> = {
  'triage.extract': 'Read and triaged the request',
  'triage.fallback': 'Triaged by rules (model unavailable)',
  safety_rule: 'Safety rule',
  send_customer_message: 'Messaged the customer',
  send_invoice: 'Sent the invoice',
  create_job: 'Created the job',
  geocode: 'Looked up the address',
  weather: 'Checked the weather',
  optimiser: 'Planned routes',
  'invoice.price': 'Priced the invoice',
  'quote.build': 'Built the quote',
  'report.from_voice': 'Wrote the job report',
  'eval.summary': 'Scored the results',
  business_snapshot: 'Checked the numbers',
  find_customer: 'Looked up a customer',
  get_schedule: 'Read the schedule',
  mark_technician_out: 'Marked a tech out',
  mark_technician_back: 'Brought a tech back',
  move_job: 'Moved a visit',
  run_weather_campaign: 'Drafted a weather campaign',
  simulate_weather: 'Set demo weather',
  intake: 'Intake',
}
const sentence = (s: string) => {
  const t = s.replace(/[_.]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
export const triggerLabel = (t: string) => TRIGGER_LABEL[t] ?? sentence(t)
export const stepLabel = (n: string) => STEP_LABEL[n] ?? sentence(n)
/** Gemini Flash list price (about $0.30 per million tokens in, $2.50 out). The free tier costs $0, so this is for scale. */
export const aiCost = (tokensIn: number, tokensOut: number) => (tokensIn * 0.3 + tokensOut * 2.5) / 1e6
export const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)

export const fileToMedia = (f: File) =>
  new Promise<{ mimeType: string; data: string }>((resolve, reject) => {
    // downscale big phone photos so uploads stay small
    const img = new Image()
    const url = URL.createObjectURL(f)
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve({
        mimeType: 'image/jpeg',
        data: c.toDataURL('image/jpeg', 0.85).split(',')[1],
      })
    }
    img.onerror = reject
    img.src = url
  })
