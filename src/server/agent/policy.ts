import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { publish } from '../lib/bus'
import { getSettings, type Policy } from '../domain/settings'
import type { Run } from './trace'

/**
 * Every side-effecting action an agent wants to take goes through here.
 * - auto:    run it now
 * - approve: park it in the owner's Approval queue; it runs when approved
 * - never:   refuse and escalate
 * Low model confidence downgrades "auto" to "approve".
 */
export type Action = {
  /** policy key, e.g. "send_customer_message" */
  policy: string
  /** registered executor name */
  tool: string
  args: Record<string, unknown>
  summary: string
  confidence?: number
  /** force approval regardless of policy (e.g. after-hours) */
  forceApproval?: string
}

type Executor = (args: Record<string, unknown>) => Promise<unknown>
const g = globalThis as unknown as { __executors?: Map<string, Executor> }
const executors = g.__executors ?? (g.__executors = new Map())

export function registerExecutor(tool: string, fn: Executor) {
  executors.set(tool, fn)
}

export type ActOutcome =
  | { status: 'done'; result: unknown }
  | { status: 'pending_approval'; approvalId: number }
  | { status: 'refused'; reason: string }

export async function act(run: Run | null, action: Action): Promise<ActOutcome> {
  const settings = await getSettings()
  let policy: Policy = settings.policies[action.policy] ?? 'approve'
  let reason = `policy "${action.policy}" = ${policy}`
  if (policy === 'auto' && action.confidence !== undefined && action.confidence < settings.thresholds.minConfidence) {
    policy = 'approve'
    reason = `confidence ${action.confidence.toFixed(2)} below ${settings.thresholds.minConfidence}`
  }
  if (policy === 'auto' && action.forceApproval) {
    policy = 'approve'
    reason = action.forceApproval
  }
  await run?.step('policy', action.tool, { summary: action.summary, policy: action.policy }, { decision: policy, reason })

  if (policy === 'never') {
    await publish('agent.refused', { tool: action.tool, summary: action.summary, reason })
    return { status: 'refused', reason }
  }
  if (policy === 'approve') {
    const [row] = await db
      .insert(schema.approvals)
      .values({ runId: run?.id, agent: run?.agent ?? 'ops', tool: action.tool, args: action.args, summary: action.summary, reason })
      .returning({ id: schema.approvals.id })
    await publish('approval.requested', { approvalId: row.id, summary: action.summary, reason })
    return { status: 'pending_approval', approvalId: row.id }
  }
  const result = await execute(run, action.tool, action.args)
  return { status: 'done', result }
}

async function execute(run: Run | null, tool: string, args: Record<string, unknown>) {
  const fn = executors.get(tool)
  if (!fn) throw new Error(`unknown executor ${tool}`)
  return run ? run.timed('tool', tool, args, () => fn(args)) : fn(args)
}

export async function decideApproval(id: number, decision: 'approved' | 'rejected', edits?: Record<string, unknown>) {
  const [ap] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id))
  if (!ap || ap.status !== 'pending') throw new Error('approval not pending')
  let result: unknown = null
  if (decision === 'approved') {
    const args = { ...ap.args, ...(edits ?? {}) }
    result = await execute(null, ap.tool, args)
  }
  await db
    .update(schema.approvals)
    .set({ status: decision, decidedAt: new Date(), result: result as object })
    .where(eq(schema.approvals.id, id))
  await publish('approval.decided', { approvalId: id, decision, summary: ap.summary })
  return result
}
