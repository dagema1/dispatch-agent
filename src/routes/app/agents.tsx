import { createFileRoute } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getTrace } from '#/fns'
import { Empty, Muted, PageTitle, Section, Status } from '#/ui/bits'
import { AGENT_LABEL, ago } from '#/ui/format'
import { useSnap } from '#/ui/live'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/agents')({ component: Agents })

const KIND_STYLE: Record<string, string> = {
  llm: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  tool: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  policy: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  note: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
}

function Agents() {
  const snap = useSnap()
  const [sel, setSel] = useState<string | null>(snap.runs[0]?.id ?? null)
  const [filter, setFilter] = useState<string>('all')
  const runs = snap.runs.filter((r) => filter === 'all' || r.agent === filter)
  const tokens = snap.runs.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0)
  return (
    <div>
      <PageTitle
        title="Agent traces"
        sub={`Every model call, tool call and policy decision, with timings. ${snap.runs.length} recent runs · ${tokens.toLocaleString()} tokens.`}
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
        <Section title="Runs">
          {runs.length === 0 ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <ScrollArea className="-mx-2 h-[70vh]">
              <ul className="px-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSel(r.id)}
                      className={cn('w-full rounded-lg px-2 py-2 text-left transition-colors', sel === r.id ? 'bg-accent' : 'hover:bg-muted')}
                    >
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-medium">{AGENT_LABEL[r.agent] ?? r.agent}</span>
                        <Muted>· {r.trigger}</Muted>
                        <span className="ml-auto">
                          <Status s={r.status} />
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{r.outcome ?? r.subject}</div>
                      <div className="text-[10px] text-muted-foreground/80 tabular-nums">
                        {ago(r.startedAt)} {r.latencyMs != null ? `· ${(r.latencyMs / 1000).toFixed(1)}s` : ''}{' '}
                        {r.tokensIn + r.tokensOut > 0 ? `· ${(r.tokensIn + r.tokensOut).toLocaleString()} tok` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </Section>
        {sel ? <TraceView runId={sel} /> : <div />}
      </div>
    </div>
  )
}

function TraceView({ runId }: { runId: string }) {
  const [t, setT] = useState<Awaited<ReturnType<typeof getTrace>> | null>(null)
  useEffect(() => {
    getTrace({ data: { runId } }).then(setT)
  }, [runId])
  if (!t?.run)
    return (
      <Section title="Trace">
        <div className="space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </Section>
    )
  return (
    <Section title={`${AGENT_LABEL[t.run.agent] ?? t.run.agent} · ${t.run.trigger}`} right={<Muted>{t.run.model ?? 'rules only'}</Muted>}>
      <p className="mb-3 text-sm text-muted-foreground">{t.run.outcome ?? t.run.subject}</p>
      <ol className="relative space-y-3 border-l pl-4">
        {t.steps.map((s) => (
          <li key={s.id}>
            <div className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-card bg-muted-foreground/40" />
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className={cn('border-transparent', KIND_STYLE[s.kind])}>
                {s.kind}
              </Badge>
              <span className="font-medium">{s.name}</span>
              {s.ms != null && <Muted className="tabular-nums">{s.ms} ms</Muted>}
            </div>
            {(s.input != null || s.output != null) && (
              <details className="group mt-1">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
                  <ChevronRight className="size-3 transition-transform group-open:rotate-90" /> details
                </summary>
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  {s.input != null && <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(s.input, null, 2)}</pre>}
                  {s.output != null && <pre className="max-h-64 overflow-auto rounded-md bg-foreground p-2 text-[11px] text-background">{JSON.stringify(s.output, null, 2)}</pre>}
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>
    </Section>
  )
}
