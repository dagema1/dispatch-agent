import { createHmac, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { env } from './lib/env'

/**
 * Owner sign-in: one shared password (OWNER_PASSWORD, "demo" when unset) and a signed,
 * httpOnly session cookie. Customers never sign in; their pages use per-link tokens.
 */
const COOKIE = 'owner_session'
const DAYS = 14
const secret = () => `${env.SESSION_SECRET ?? env.CRON_SECRET}:${password()}`
export const password = () => env.OWNER_PASSWORD ?? 'demo'
export const usingDemoPassword = () => !env.OWNER_PASSWORD

const sign = (exp: number) => createHmac('sha256', secret()).update(`owner.${exp}`).digest('base64url')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function isOwner(): boolean {
  const v = getCookie(COOKIE)
  const [exp, sig] = v?.split('.') ?? []
  const n = Number(exp)
  return !!sig && Number.isFinite(n) && n > Date.now() && same(sig, sign(n))
}

export function assertOwner() {
  if (!isOwner()) throw new Error('Not signed in')
}

export function signIn(attempt: string): boolean {
  if (!same(attempt, password())) return false
  const exp = Date.now() + DAYS * 86_400_000
  setCookie(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: DAYS * 86_400,
  })
  return true
}

export const signOut = () => deleteCookie(COOKIE, { path: '/' })
