import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env'

/** Signed, unguessable customer links (quote, live ETA, photo upload, payment status). */
export function sign(kind: string, id: number): string {
  const mac = createHmac('sha256', env.CRON_SECRET).update(`${kind}:${id}`).digest('base64url').slice(0, 16)
  return `${id}.${mac}`
}

export function verify(kind: string, token: string): number | null {
  const [idStr, mac] = token.split('.')
  const id = Number(idStr)
  if (!Number.isInteger(id) || !mac) return null
  const expected = sign(kind, id).split('.')[1]
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b) ? id : null
}

export const links = {
  track: (jobId: number) => `${env.APP_URL}/c/track/${sign('track', jobId)}`,
  quote: (quoteId: number) => `${env.APP_URL}/c/quote/${sign('quote', quoteId)}`,
  photos: (requestId: number) => `${env.APP_URL}/c/photos/${sign('photos', requestId)}`,
}
