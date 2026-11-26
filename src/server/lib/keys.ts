import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { env } from './env'

/**
 * API keys the owner can enter in setup. Whatever the server was started with (.env) is the
 * default; a saved key overrides it. Keys are stored server-side only and never sent back to the
 * browser in full: the UI sees whether each one is set and where it came from.
 */
export const KEY_NAMES = ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_CHAT_ID', 'ORS_API_KEY', 'STRIPE_SECRET_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const
export type KeyName = (typeof KEY_NAMES)[number]
type Saved = Partial<Record<KeyName, string>>

const g = globalThis as unknown as { __envDefaults?: Saved; __genai?: unknown; __stripe?: unknown }
// captured once, before any overlay, so "use the server default" always means the .env value
g.__envDefaults ??= Object.fromEntries(KEY_NAMES.map((k) => [k, env[k]])) as Saved
const defaults = g.__envDefaults

async function saved(): Promise<Saved> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'api_keys'))
  return (row?.value as Saved | undefined) ?? {}
}

/** Put saved keys on top of the .env defaults and drop clients built with the old ones. */
export async function applyKeys() {
  const s = await saved()
  for (const k of KEY_NAMES) (env as Record<string, string | undefined>)[k] = s[k] || defaults[k]
  g.__genai = undefined
  g.__stripe = undefined
}

export async function saveKeys(patch: Saved, { demo = false } = {}) {
  // demo mode runs on the server's own keys: clear any override
  const next: Saved = demo ? {} : { ...(await saved()) }
  if (!demo)
    for (const k of KEY_NAMES) {
      const v = patch[k]
      if (v === undefined) continue
      if (v.trim() === '') delete next[k]
      else next[k] = v.trim()
    }
  await db
    .insert(schema.settings)
    .values({ key: 'api_keys', value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next } })
  await applyKeys()
}

const mask = (v: string) => (v.length <= 8 ? '••••' : `••••${v.slice(-4)}`)

/** What the setup screen may show: never the key itself. */
export async function keyStatus() {
  const s = await saved()
  return KEY_NAMES.map((k) => ({
    name: k,
    source: s[k] ? ('saved' as const) : defaults[k] ? ('server' as const) : ('none' as const),
    hint: s[k] ? mask(s[k]!) : defaults[k] ? mask(defaults[k]!) : null,
  }))
}
