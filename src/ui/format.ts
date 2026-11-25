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
export const P_STYLE: Record<number, string> = {
  1: 'bg-red-500/12 text-red-700 ring-1 ring-red-500/25 dark:text-red-300',
  2: 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300',
  3: 'bg-sky-500/12 text-sky-800 ring-1 ring-sky-500/25 dark:text-sky-300',
  4: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15',
}
export const P_LABEL: Record<number, string> = {
  1: 'P1 Emergency',
  2: 'P2 Urgent',
  3: 'P3 Routine',
  4: 'P4 Planned',
}
export const STATUS_STYLE: Record<string, string> = {
  unassigned: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15',
  scheduled: 'bg-primary/12 text-primary ring-1 ring-primary/20',
  en_route: 'bg-violet-500/12 text-violet-700 ring-1 ring-violet-500/25 dark:text-violet-300',
  on_site: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300',
  done: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950',
  cancelled: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15 line-through',
  pending: 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300',
  approved: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300',
  rejected: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15',
  sent: 'bg-primary/12 text-primary ring-1 ring-primary/20',
  paid: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950',
  draft: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15',
  accepted: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300',
  running: 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300',
  failed: 'bg-red-500/12 text-red-700 ring-1 ring-red-500/25 dark:text-red-300',
  waiting_approval: 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300',
  booked: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300',
  triaged: 'bg-sky-500/12 text-sky-800 ring-1 ring-sky-500/25 dark:text-sky-300',
  awaiting_customer: 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300',
  escalated: 'bg-red-500/12 text-red-700 ring-1 ring-red-500/25 dark:text-red-300',
  closed: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15',
  new: 'bg-muted-foreground/10 text-muted-foreground ring-1 ring-muted-foreground/15',
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
