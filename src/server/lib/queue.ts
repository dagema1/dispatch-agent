import { sql } from 'drizzle-orm'
import { db, schema } from '../db'

/**
 * Durable job queue on Postgres. Work survives restarts, retries with exponential backoff,
 * and `SELECT … FOR UPDATE SKIP LOCKED` lets several instances pull work without double-processing.
 * `dedupeKey` makes enqueueing idempotent (e.g. one reminder per invoice per day).
 */
export type Handler = (payload: Record<string, unknown>) => Promise<unknown>
const g = globalThis as unknown as { __handlers?: Map<string, Handler>; __worker?: NodeJS.Timeout; __draining?: boolean }
const handlers = g.__handlers ?? (g.__handlers = new Map())

export function registerHandler(kind: string, fn: Handler) {
  handlers.set(kind, fn)
}

export async function enqueue(kind: string, payload: Record<string, unknown> = {}, opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {}) {
  await db
    .insert(schema.queue)
    .values({ kind, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing()
  kick()
}

type Claimed = { id: number; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }

async function claim(limit: number): Promise<Claimed[]> {
  const res = await db.execute(sql`
    UPDATE queue SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM queue
      WHERE (status = 'pending' AND run_at <= now())
         OR (status = 'running' AND locked_at < now() - interval '5 minutes')
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts, max_attempts`)
  return res.rows as Claimed[]
}

/** Process due work. Returns number of items handled. */
export async function drain(limit = 20): Promise<number> {
  if (g.__draining) return 0
  g.__draining = true
  let n = 0
  try {
    for (;;) {
      const items = await claim(limit)
      if (!items.length) break
      await Promise.all(
        items.map(async (it) => {
          const fn = handlers.get(it.kind)
          try {
            if (!fn) throw new Error(`no handler for ${it.kind}`)
            await fn(it.payload)
            await db.execute(sql`UPDATE queue SET status='done', done_at=now(), last_error=null WHERE id=${it.id}`)
          } catch (e) {
            const msg = (e as Error).message?.slice(0, 500) ?? String(e)
            const failed = it.attempts >= it.max_attempts
            const backoffSec = Math.min(600, 2 ** it.attempts * 5)
            await db.execute(sql`
              UPDATE queue SET status=${failed ? 'failed' : 'pending'}, last_error=${msg},
                run_at = now() + make_interval(secs => ${backoffSec})
              WHERE id=${it.id}`)
            console.error(`[queue] ${it.kind}#${it.id} attempt ${it.attempts} failed: ${msg}`)
          }
          n++
        }),
      )
    }
  } finally {
    g.__draining = false
  }
  return n
}

let kickTimer: NodeJS.Timeout | undefined
/** Ask the worker to run soon (coalesces bursts). */
export function kick() {
  if (kickTimer) return
  kickTimer = setTimeout(() => {
    kickTimer = undefined
    drain().catch((e) => console.error('[queue] drain', e))
  }, 50)
}

/** Background poller for delayed work. Idempotent: safe to call on every module load. */
export function startWorker(intervalMs = 3000) {
  if (g.__worker) return
  g.__worker = setInterval(() => drain().catch((e) => console.error('[queue]', e)), intervalMs)
}
