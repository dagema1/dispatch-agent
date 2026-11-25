import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { env } from '../lib/env'

/**
 * Gmail + Google Calendar via OAuth 2.0 (plain fetch, minimal scopes).
 * The refresh token is stored in the settings table after the owner clicks "Connect Google".
 */
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar.events', 'openid', 'email']
const redirectUri = () => `${env.APP_URL}/api/google/callback`

export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

type Stored = { refreshToken: string; email?: string; historyId?: string }
async function stored(): Promise<Stored | null> {
  const [r] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'google_oauth'))
  return (r?.value as Stored) ?? null
}
async function store(v: Stored) {
  await db.insert(schema.settings).values({ key: 'google_oauth', value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } })
}

export async function gmailConnected() {
  return !!(env.GOOGLE_CLIENT_ID && (await stored())?.refreshToken)
}
export async function googleAccount() {
  return (await stored())?.email ?? null
}

export async function exchangeCode(code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  })
  const t = (await res.json()) as { refresh_token?: string; access_token?: string; error?: string }
  if (!t.refresh_token) throw new Error(t.error ?? 'no refresh token')
  const me = (await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${t.access_token}` } })).json()) as { emailAddress?: string; historyId?: string }
  await store({ refreshToken: t.refresh_token, email: me.emailAddress, historyId: me.historyId })
}

let access: { token: string; exp: number } | null = null
async function token(): Promise<string> {
  if (access && access.exp > Date.now() + 60_000) return access.token
  const s = await stored()
  if (!s) throw new Error('Google not connected')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: s.refreshToken, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
  })
  const t = (await res.json()) as { access_token: string; expires_in: number }
  access = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 }
  return access.token
}

async function gapi<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (res.status === 204 ? null : await res.json()) as T
}

const b64url = (s: string) => Buffer.from(s).toString('base64url')

export async function sendGmail(opts: { to: string; subject: string; body: string; threadId?: string; inReplyTo?: string }) {
  const headers = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
  ]
  return gapi('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: b64url(`${headers.join('\r\n')}\r\n\r\n${opts.body}`), threadId: opts.threadId }),
  })
}

export type InboundEmail = { id: string; threadId: string; from: string; fromName: string; subject: string; text: string; messageId: string }

/** New inbox messages since last poll (unread, not sent by us), marked read once fetched. */
export async function pollInbox(): Promise<InboundEmail[]> {
  if (!(await gmailConnected())) return []
  const list = await gapi<{ messages?: Array<{ id: string }> }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent('is:unread in:inbox newer_than:2d -from:me') + '&maxResults=10',
  )
  const out: InboundEmail[] = []
  for (const m of list.messages ?? []) {
    const full = await gapi<{
      id: string
      threadId: string
      payload: { headers: Array<{ name: string; value: string }>; mimeType: string; body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string } }> }
    }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`)
    const h = (n: string) => full.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? ''
    const from = h('from')
    const part = full.payload.parts?.find((p) => p.mimeType === 'text/plain') ?? full.payload
    const text = part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : ''
    out.push({
      id: full.id,
      threadId: full.threadId,
      from: from.match(/<(.+)>/)?.[1] ?? from,
      fromName: from.replace(/<.+>/, '').replace(/"/g, '').trim(),
      subject: h('subject'),
      text: text.split(/\nOn .+ wrote:\n/)[0].trim(),
      messageId: h('message-id'),
    })
    await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) })
  }
  return out
}

/** Mirror a planned visit into the owner's Google Calendar (one event per job). */
export async function upsertCalendarEvent(opts: { eventId?: string | null; title: string; description: string; start: Date; end: Date; location: string; colorId?: string }) {
  if (!(await gmailConnected())) return null
  const body = JSON.stringify({
    summary: opts.title,
    description: opts.description,
    location: opts.location,
    start: { dateTime: opts.start.toISOString() },
    end: { dateTime: opts.end.toISOString() },
    colorId: opts.colorId,
  })
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
  if (opts.eventId) {
    try {
      const ev = await gapi<{ id: string }>(`${base}/${opts.eventId}`, { method: 'PUT', body })
      return ev.id
    } catch {
      /* fall through: recreate */
    }
  }
  const ev = await gapi<{ id: string }>(base, { method: 'POST', body })
  return ev.id
}

export async function deleteCalendarEvent(eventId: string) {
  if (!(await gmailConnected())) return
  await gapi(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, { method: 'DELETE' }).catch(() => {})
}
