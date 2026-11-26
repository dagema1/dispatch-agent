export const TZ = 'America/Denver'
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
        timeZone: TZ,
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(d))
    : '—'
export const dayTime = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
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
export const dayOf = (d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d))
export const minutesOfDay = (d: string | Date) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
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
