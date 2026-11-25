import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { publish } from '../lib/bus'

export type AgentName = 'front_desk' | 'diagnosis' | 'dispatch' | 'revenue' | 'ops'

/**
 * A trace of one agent run: every LLM call, tool call and policy decision becomes a step,
 * with timing and token usage. The "Agent traces" screen renders these.
 */
export class Run {
  private constructor(
    readonly id: string,
    readonly agent: AgentName,
    private started: number,
  ) {}

  static async start(agent: AgentName, trigger: string, subject?: string): Promise<Run> {
    const [row] = await db.insert(schema.agentRuns).values({ agent, trigger, subject }).returning({ id: schema.agentRuns.id })
    await publish('agent.run_started', { runId: row.id, agent, trigger, subject })
    return new Run(row.id, agent, Date.now())
  }

  async step(kind: 'llm' | 'tool' | 'policy' | 'note' | 'error', name: string, input?: unknown, output?: unknown, ms?: number) {
    await db.insert(schema.agentSteps).values({ runId: this.id, kind, name, input: input ?? null, output: output ?? null, ms })
  }

  /** Time an async operation and record it as a step. */
  async timed<T>(kind: 'llm' | 'tool', name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now()
    try {
      const out = await fn()
      await this.step(kind, name, input, summarise(out), Date.now() - t0)
      return out
    } catch (e) {
      await this.step('error', name, input, { error: (e as Error).message }, Date.now() - t0)
      throw e
    }
  }

  async tokens(model: string, tin: number, tout: number) {
    await db
      .update(schema.agentRuns)
      .set({ model, tokensIn: sql`${schema.agentRuns.tokensIn} + ${tin}`, tokensOut: sql`${schema.agentRuns.tokensOut} + ${tout}` })
      .where(eq(schema.agentRuns.id, this.id))
  }

  async end(status: 'done' | 'failed' | 'waiting_approval', outcome: string) {
    await db
      .update(schema.agentRuns)
      .set({ status, outcome, endedAt: new Date(), latencyMs: Date.now() - this.started })
      .where(eq(schema.agentRuns.id, this.id))
    await publish('agent.run_finished', { runId: this.id, agent: this.agent, status, outcome })
  }
}

function summarise(v: unknown): unknown {
  const s = JSON.stringify(v ?? null)
  if (s && s.length > 4000) return { truncated: true, preview: s.slice(0, 4000) }
  return v ?? null
}
