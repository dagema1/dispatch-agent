import './agent/front-desk'
import './agent/revenue'
import './agent/owner'
import './agent/office-log'
import { onOwnerReady } from './agent/owner-bot'
import { onTelegramUpdate } from './agent/telegram-bot'
import { runMigrations } from './db/migrate'
import { startTelegramPolling } from './integrations/telegram'
import { CRON, type CronName } from './jobs/ops'
import { env } from './lib/env'
import { startWorker } from './lib/queue'

/**
 * One-time server start-up (idempotent across hot reloads): migrations, queue worker,
 * Telegram long polling and — when no external scheduler is configured — local cron timers.
 * In production Cloud Scheduler calls /api/cron/<name> instead (set EXTERNAL_CRON=1).
 */
const g = globalThis as unknown as { __boot?: Promise<void> }

export function ensureBooted() {
  g.__boot ??= (async () => {
    await runMigrations()
    // owner-entered API keys (setup wizard) override .env before anything uses them
    await (await import('./lib/keys')).applyKeys()
    startWorker()
    startTelegramPolling(async (u) => void (await onTelegramUpdate(u)), onOwnerReady)
    if (!process.env.EXTERNAL_CRON) startLocalCron()
    console.log(`[boot] dispatch agent ready on ${env.APP_URL}`)
  })().catch((e) => {
    g.__boot = undefined
    throw e
  })
  return g.__boot
}

export async function runCron(name: CronName) {
  await ensureBooted()
  return CRON[name]()
}

function startLocalCron() {
  const safe = (n: CronName) => () => CRON[n]().catch((e) => console.error(`[cron ${n}]`, e))
  setInterval(safe('tick'), 60_000)
  // morning & weather: check every 5 min whether it's time (company time zone)
  const done = new Set<string>()
  setInterval(() => {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: env.TZ }).format(new Date())
    for (const [name, at] of [
      ['weather', '06:00'],
      ['morning', '06:30'],
    ] as const) {
      const key = `${name}:${day}`
      if (hm >= at && hm < '07:30' && !done.has(key)) {
        done.add(key)
        safe(name)()
      }
    }
  }, 5 * 60_000)
}
