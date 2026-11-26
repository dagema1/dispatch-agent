import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, CircleAlert, ShieldQuestion, Sparkles, StickyNote, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getTrace } from '#/fns'
import { AgentsTabs } from '#/ui/AgentsTabs'
import { AgentTile, Empty, Muted, PageTitle, Section, Status } from '#/ui/bits'
import { AGENT_LABEL, ago, aiCost, stepLabel, triggerLabel, usd } from '#/ui/format'
import { useSnap } from '#/ui/live'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/agents')({
  component: Agents,
  validateSearch: (s: Record<string, unknown>): { run?: string } => (typeof s.run === 'string' && s.run ? { run: s.run } : {}),
})

/** Step kinds as tiles: model calls in the accent, policy holds in gold, errors red, the rest quiet. */
const KIND: Record<string, { tile: string; icon: React.ComponentType<{ className?: string }> }> = {
  llm: { tile: 'tile-action', icon: Sparkles },
  tool: { tile: 'tile-quiet', icon: Wrench },
  policy: { tile: 'tile-attn', icon: ShieldQuestion },
  note: { tile: 'tile-quiet', icon: StickyNote },
  error: { tile: 'tile-red', icon: CircleAlert },
}

function Agents() {
  const snap = useSnap()
  const [filter, setFilter] = useState<string>('all')
  const runs = snap.runs.filter((r) => filter === 'all' || r.agent === filter)
  // ?run= picks the trace. Phones show either the list or the chosen trace; wide screens show both.
  const { run } = Route.useSearch()
  const navigate = Route.useNavigate()
  const sel = run ?? runs[0]?.id ?? null
  const setSel = (id: string) => navigate({ search: { run: id } })
  const cost = snap.runs.reduce((a, r) => a + aiCost(r.tokensIn, r.tokensOut), 0)
  return (
    <div>
      <AgentsTabs />
      <PageTitle
        title="Agent traces"
        sub={`${snap.runs.length} recent runs · ${usd(cost)} AI cost at list price`}
        right={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {Object.entries(AGENT_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Section title="Runs" className={cn(run && 'max-lg:hidden')}>
          {runs.length === 0 ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <ScrollArea className="-mx-2 lg:h-[70vh]">
              <ul className="px-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSel(r.id)}
                      className={cn(
                        'flex w-full gap-3 rounded-xl px-2 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        sel === r.id ? 'bg-foreground/8 shadow-[inset_0_1px_0_var(--edge)]' : 'hover:bg-foreground/5',
                      )}
                    >
                      <AgentTile agent={r.agent} />
                      <span className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="font-medium">{AGENT_LABEL[r.agent] ?? r.agent}</span>
                          <Muted>· {triggerLabel(r.trigger)}</Muted>
                          <span className="ml-auto">
                            <Status s={r.status} undelivered={r.undelivered} />
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{r.outcome ?? r.subject}</div>
                        <div className="text-[10px] text-muted-foreground/80 tabular-nums">
                          {ago(r.startedAt)} {r.latencyMs != null ? `· ${(r.latencyMs / 1000).toFixed(1)}s` : ''}{' '}
                          {r.tokensIn + r.tokensOut > 0 ? `· ${usd(aiCost(r.tokensIn, r.tokensOut))}` : ''}
                        </div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </Section>
        {sel ? (
          <div className={cn('min-w-0 space-y-3', !run && 'max-lg:hidden')}>
            <Button variant="ghost" size="sm" className="-ml-2 lg:hidden" onClick={() => navigate({ search: {} })}>
              <ChevronLeft /> All runs
            </Button>
            <TraceView runId={sel} />
          </div>
        ) : (
          <div />
        )}
      </div>
    </div>
  )
}

function TraceView({ runId }: { runId: string }) {
  // undefined = loading, null = not found or failed (shown as such, not as an endless shimmer)
  const [t, setT] = useState<Awaited<ReturnType<typeof getTrace>> | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setT(undefined)
    getTrace({ data: { runId } })
      .then((r) => live && setT(r ?? null))
      .catch(() => live && setT(null))
    return () => {
      live = false
    }
  }, [runId])
  if (t === undefined)
    return (
      <Section title="Trace">
        <div className="space-y-3" aria-busy="true">
          <output className="sr-only">Loading trace…</output>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </Section>
    )
  if (!t?.run)
    return (
      <Section title="Trace">
        <Empty>This trace is no longer available. Demo resets clear old runs.</Empty>
      </Section>
    )
  return (
    <Section title={`${AGENT_LABEL[t.run.agent] ?? t.run.agent} · ${triggerLabel(t.run.trigger)}`} right={<Muted>{t.run.model ?? 'rules only'}</Muted>}>
      <p className="mb-3 text-sm text-muted-foreground">{t.run.outcome ?? t.run.subject}</p>
      <ol>
        {t.steps.map((s, i) => {
          const k = KIND[s.kind] ?? KIND.note
          const last = i === t.steps.length - 1
          return (
            <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
              {!last && <span className="absolute top-9 bottom-1 left-[15px] border-l border-dashed border-foreground/20" aria-hidden />}
              <span className={cn('tile size-8 shrink-0 rounded-full', k.tile)} title={s.kind}>
                <k.icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium" title={s.name}>
                    {stepLabel(s.name)}
                  </span>
                  <Muted className="capitalize">{s.kind === 'llm' ? 'model' : s.kind}</Muted>
                  {s.ms != null && <Muted className="ml-auto tabular-nums">{s.ms} ms</Muted>}
                </div>
                {(s.input != null || s.output != null) && (
                  <details className="group mt-1">
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronRight className="size-3 transition-transform group-open:rotate-90" /> Input and output
                    </summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {s.input != null && <Pre label="Input" v={s.input} />}
                      {s.output != null && <Pre label="Output" v={s.output} />}
                    </div>
                  </details>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

const Pre = ({ label, v }: { label: string; v: unknown }) => (
  <div className="well min-w-0 rounded-xl">
    <div className="border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{label}</div>
    <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-relaxed">{JSON.stringify(v, null, 2)}</pre>
  </div>
)
