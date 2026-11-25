import 'dotenv/config'

function opt(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v.trim() : undefined
}

/** Typed access to configuration. Every integration degrades gracefully when its key is missing. */
export const env = {
  DATABASE_URL: opt('DATABASE_URL') ?? 'postgresql://postgres:postgres@localhost:5432/dispatch_agent',
  APP_URL: opt('APP_URL') ?? 'http://localhost:3000',
  GEMINI_API_KEY: opt('GEMINI_API_KEY'),
  GEMINI_MODEL: opt('GEMINI_MODEL') ?? 'gemini-3.8-flash',
  GEMINI_LIVE_MODEL: opt('GEMINI_LIVE_MODEL'),
  TELEGRAM_BOT_TOKEN: opt('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_OWNER_CHAT_ID: opt('TELEGRAM_OWNER_CHAT_ID'),
  ORS_API_KEY: opt('ORS_API_KEY'),
  STRIPE_SECRET_KEY: opt('STRIPE_SECRET_KEY'),
  CRON_SECRET: opt('CRON_SECRET') ?? 'dev-secret',
  GOOGLE_CLIENT_ID: opt('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: opt('GOOGLE_CLIENT_SECRET'),
  TZ: opt('COMPANY_TZ') ?? 'America/Denver',
}

export const integrations = () => ({
  gemini: !!env.GEMINI_API_KEY,
  telegram: !!env.TELEGRAM_BOT_TOKEN,
  ors: !!env.ORS_API_KEY,
  stripe: !!env.STRIPE_SECRET_KEY?.startsWith('sk_test_'),
  google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
})
