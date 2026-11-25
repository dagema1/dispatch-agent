import { env } from './env'

/** Offset (minutes) of `tz` from UTC at instant `d`. */
function tzOffsetMin(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - d.getTime()) / 60000)
}

/** Build the instant for a wall-clock date + time in the company time zone. */
export function zoned(day: string, hhmm: string, tz = env.TZ): Date {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const off = tzOffsetMin(guess, tz)
  return new Date(guess.getTime() - off * 60000)
}

/** 'YYYY-MM-DD' of an instant in the company time zone. */
export function dayOf(d: Date, tz = env.TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function fmtTime(d: Date | string | null | undefined, tz = env.TZ): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d))
}

export function fmtDayTime(d: Date | string | null | undefined, tz = env.TZ): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

export const MIN = 60_000
