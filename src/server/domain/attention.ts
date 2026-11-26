import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { publish } from '../lib/bus'

/** The owner dealt with a request themselves (called back, sent someone, not ours): it leaves the queue. */
export async function resolveRequest(requestId: number, note?: string) {
  const [r] = await db.update(schema.requests).set({ status: 'closed' }).where(eq(schema.requests.id, requestId)).returning()
  if (!r) throw new Error('request not found')
  await publish('request.resolved', { requestId, summary: r.summary, note: note ?? null })
  return { ok: true }
}

/** Drop a visit nobody will make (the customer cancelled or it was handled another way). */
export async function cancelVisit(jobId: number) {
  const [j] = await db.update(schema.jobs).set({ status: 'cancelled', technicianId: null }).where(eq(schema.jobs.id, jobId)).returning()
  if (!j) throw new Error('visit not found')
  await publish('job.cancelled', { jobId, title: j.title })
  return { ok: true }
}
