import { EventEmitter } from 'node:events'
import { db, schema } from '../db'

/**
 * Domain event bus. Every event is persisted (append-only log, used by the activity feed and
 * replay) and fanned out in-process to subscribers: agents react to events, and the SSE endpoint
 * streams them to open dashboards.
 */
export type DomainEvent = { id: number; type: string; payload: Record<string, unknown>; createdAt: string }

const g = globalThis as unknown as { __bus?: EventEmitter }
const emitter = g.__bus ?? (g.__bus = new EventEmitter().setMaxListeners(100))

export async function publish(type: string, payload: Record<string, unknown> = {}): Promise<DomainEvent> {
  const [row] = await db.insert(schema.events).values({ type, payload }).returning()
  const ev: DomainEvent = { id: row.id, type, payload, createdAt: row.createdAt.toISOString() }
  emitter.emit('event', ev)
  return ev
}

export function subscribe(fn: (ev: DomainEvent) => void): () => void {
  emitter.on('event', fn)
  return () => emitter.off('event', fn)
}
