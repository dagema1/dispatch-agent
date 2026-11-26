import { createFileRoute } from '@tanstack/react-router'
import { Building2, CloudSun, FlaskConical, Hourglass, Inbox, Play, Snowflake, Sparkles, Sun, Timer, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { runEvals, runSimulation } from '#/fns'
import { ErrorText, Muted, PageTitle, Stat } from '#/ui/bits'
import { money } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/roi')({ component: Roi })

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`)

function Roi() {
  const snap = useSnap()
  const k = snap.kpis
  // Gemini Flash list price is ~$0.30/M in, $2.50/M out; free tier costs $0, shown for scale
  const aiCost = (k.tokensIn * 0.3 + k.tokensOut * 2.5) / 1e6
  const hoursSaved = k.minutesSaved / 60
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageTitle title="ROI & simulator" sub="The last 7 days of real activity, a simulated day against a human office, and triage accuracy." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Timer}
          label="Median first response"
          value={k.medianResponseSec == null ? '—' : k.medianResponseSec < 90 ? `${Math.round(k.medianResponseSec)} s` : `${Math.round(k.medianResponseSec / 60)} min`}
          hint="industry norm: hours, or a missed call"
          tone="good"
        />
        <Stat label="Requests handled" icon={Inbox} value={k.requests} hint={`${k.afterHours} after hours · ${pct(k.bookingRate)} booked`} ratio={k.bookingRate ?? undefined} />
        <Stat
          icon={Wallet}
          label="Collected / invoiced"
          value={`${money(k.collectedCents)} / ${money(k.invoicedCents)}`}
          hint={k.daysToPaid != null ? `${k.daysToPaid.toFixed(1)} days to paid` : 'no payments yet'}
          ratio={k.invoicedCents ? k.collectedCents / k.invoicedCents : undefined}
        />
        <Stat icon={Hourglass} label="Office time saved" value={`${hoursSaved.toFixed(1)} h`} hint={`AI cost at list price: $${aiCost.toFixed(2)}`} tone="good" />
      </div>
      <Simulator />
      <Evals />
    </div>
  )
}

/* ---------- Simulator ---------- */

type Scenario = 'normal' | 'cold_snap' | 'heat_wave'
type Metrics = NonNullable<ReturnType<typeof useSnap>['lab']['sim']>['ai']

/** Each comparison row: a number to draw bars from, how to print it, and which direction is better. */
const ROWS: Array<{ label: string; v: (m: Metrics) => number | null; f: (m: Metrics) => string; higher: boolean; key?: boolean }> = [
  { label: 'Jobs completed today', v: (m) => m.servedToday, f: (m) => `${m.servedToday}`, higher: true, key: true },
  { label: 'Revenue completed today', v: (m) => m.revenueTodayCents, f: (m) => money(m.revenueTodayCents), higher: true, key: true },
  { label: 'Emergencies served today', v: (m) => m.p1ServedToday, f: (m) => `${m.p1ServedToday} of ${m.p1Total}`, higher: true, key: true },
  { label: 'Contacts answered', v: (m) => m.answered, f: (m) => `${m.answered}`, higher: true },
  { label: 'Contacts lost', v: (m) => m.lost, f: (m) => `${m.lost}`, higher: false },
  { label: 'Median time to answer', v: (m) => m.medianResponseMin, f: (m) => `${m.medianResponseMin} min`, higher: false },
  {
    label: 'Average emergency wait',
    v: (m) => m.p1AvgWaitMin,
    f: (m) => (m.p1AvgWaitMin == null ? '—' : `${Math.floor(m.p1AvgWaitMin / 60)}h ${m.p1AvgWaitMin % 60}m`),
    higher: false,
  },
  { label: 'Drive minutes per job', v: (m) => m.driveMinPerJob, f: (m) => `${m.driveMinPerJob}`, higher: false },
  { label: 'Technician utilisation', v: (m) => m.techUtilisation, f: (m) => pct(m.techUtilisation), higher: true },
]

const SCENARIOS: Array<[Scenario, React.ComponentType<{ className?: string }>, string, string]> = [
  ['normal', CloudSun, 'Normal day', 'Typical demand'],
  ['cold_snap', Snowflake, 'Cold snap', '0°F, furnaces fail'],
  ['heat_wave', Sun, 'Heat wave', '97°F, AC calls spike'],
]

function Simulator() {
  const snap = useSnap()
  const [scenario, setScenario] = useState<Scenario>('cold_snap')
  const [n, setN] = useState(120)
  const sim = useAction(() => runSimulation({ data: { scenario, requests: n } }))
  const r = snap.lab.sim
  const chart = r
    ? r.ai.servedByHour.map((v, i) => ({
        hour: `${((7 + i) % 12) + 1}${7 + i + 1 < 12 ? 'a' : 'p'}`,
        ai: v,
        human: r.human.servedByHour[i],
      }))
    : []

  return (
    <Card className="gap-0 py-0">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">Day simulator</h2>
        <Muted className="block">Same demand, same five technicians. The AI front office against one receptionist and one dispatcher working 8 to 5.</Muted>
      </div>

      <div className="flex flex-wrap items-end gap-4 border-b px-5 py-4">
        <fieldset aria-label="Scenario" className="grid flex-1 grid-cols-3 gap-2 max-xl:basis-full">
          {SCENARIOS.map(([v, I, title, sub]) => (
            <label
              key={v}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                scenario === v ? 'border-primary bg-primary/5' : 'hover:bg-secondary',
              )}
            >
              <input type="radio" name="scenario" className="sr-only" checked={scenario === v} onChange={() => setScenario(v)} />
              <I className={cn('size-4 shrink-0', scenario === v ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{title}</span>
                <span className="block truncate text-[11px] text-muted-foreground max-sm:hidden">{sub}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Contacts</div>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={String(n)} onValueChange={(v) => v && setN(Number(v))} aria-label="Contacts">
            {[60, 120, 200].map((x) => (
              <ToggleGroupItem key={x} value={String(x)} className="px-3 text-xs tabular-nums">
                {x}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Button disabled={sim.busy} onClick={() => sim.run()} className="max-sm:flex-1">
          <Play /> {sim.busy ? <span className="shimmer-text">Simulating…</span> : 'Run simulation'}
        </Button>
      </div>
      <div className="px-5">
        <ErrorText error={sim.error} />
      </div>

      {!r ? (
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Pick a scenario and run it to see both operating models side by side.</CardContent>
      ) : (
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <Legend color="bg-primary" label="AI front office" icon={Sparkles} />
              <Legend color="bg-muted-foreground/40" label="Human office" icon={Building2} />
              <span className="ml-auto tabular-nums">
                {r.requests} contacts · {r.outdoorTempF}°F · {r.ms} ms
              </span>
            </div>
            <ul className="divide-y">
              {ROWS.map((row) => (
                <CompareRow key={row.label} row={row} ai={r.ai} human={r.human} />
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <div className="well rounded-xl p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Jobs completed by hour</div>
              <div className="h-56">
                <ResponsiveContainer>
                  <AreaChart data={chart} margin={{ left: -24, right: 4, top: 4 }}>
                    <defs>
                      <linearGradient id="aiFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
                    <Area type="monotone" dataKey="human" name="Human office" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="5 4" fill="none" />
                    <Area type="monotone" dataKey="ai" name="AI front office" stroke="var(--primary)" strokeWidth={2.5} fill="url(#aiFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Assumptions: people answer one call at a time (about 6 minutes each); callers hang up after a few minutes on hold; about 45% of after-hours voicemails are never
              recovered; human dispatch is first come, first served and only fast-tracks explicit emergencies. The AI re-plans every 15 minutes and never sees a request before it
              arrives.
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

const Legend = ({ color, label, icon: I }: { color: string; label: string; icon: React.ComponentType<{ className?: string }> }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={cn('h-2 w-4 rounded-full', color)} aria-hidden />
    <I className="size-3.5" /> {label}
  </span>
)

/** One metric: two bars on a shared scale and a chip saying how much better or worse the AI did. */
function CompareRow({ row, ai, human }: { row: (typeof ROWS)[number]; ai: Metrics; human: Metrics }) {
  const a = row.v(ai)
  const h = row.v(human)
  const max = Math.max(a ?? 0, h ?? 0) || 1
  const delta = a != null && h != null && h !== 0 ? (a - h) / Math.abs(h) : null
  const better = delta != null && (row.higher ? delta > 0 : delta < 0)
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3">
      <div className={cn('text-sm', row.key ? 'font-medium' : 'text-muted-foreground')}>{row.label}</div>
      {delta != null && Math.abs(delta) >= 0.01 ? (
        <span
          className={cn(
            'justify-self-end rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
            better ? 'bg-primary/15 text-primary' : 'bg-foreground/8 text-muted-foreground',
          )}
        >
          {delta > 0 ? '+' : '−'}
          {Math.abs(delta) >= 10 ? `${Math.round(Math.abs(delta))}×` : `${Math.round(Math.abs(delta) * 100)}%`}
        </span>
      ) : (
        <span className="justify-self-end text-[11px] text-muted-foreground">same</span>
      )}
      <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-3 gap-y-1">
        <Bar value={a} max={max} className="bg-primary" />
        <span className="text-right text-sm font-semibold tabular-nums">{row.f(ai)}</span>
        <Bar value={h} max={max} className="bg-muted-foreground/35" />
        <span className="text-right text-sm text-muted-foreground tabular-nums">{row.f(human)}</span>
      </div>
    </li>
  )
}

const Bar = ({ value, max, className }: { value: number | null; max: number; className: string }) => (
  <span className="well block h-2 overflow-hidden rounded-full">
    <span className={cn('block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700', className)} style={{ width: `${((value ?? 0) / max) * 100}%` }} />
  </span>
)

/* ---------- Evals ---------- */

function Evals() {
  const snap = useSnap()
  const ev = useAction((useModel: boolean) => runEvals({ data: { useModel } }))
  const { evalRules, evalModel } = snap.lab
  type Split = NonNullable<typeof evalRules>['heldout']
  const metrics: Array<[string, (s: Split) => number | null, boolean]> = [
    ['Emergency recall (P1 caught)', (s) => s.p1Recall, true],
    ['Safety hazard recall', (s) => s.safetyRecall, true],
    ['Priority exact', (s) => s.priorityExact, true],
    ['Priority within one level', (s) => s.priorityWithinOne, true],
    ['Trade / skill routing', (s) => s.skillAccuracy, true],
    ['Over-escalated to P1', (s) => s.overEscalated, false],
  ]
  const latest = evalModel ?? evalRules
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <span className="tile tile-quiet size-9 shrink-0">
          <FlaskConical className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Triage accuracy</h2>
          <Muted className="block">45 labelled messages, including prompt injection and Spanish. Bars show the held-out set; the dev set is in small print.</Muted>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={ev.busy} onClick={() => ev.run(false)}>
            Run rules only
          </Button>
          <Button size="sm" disabled={ev.busy || !snap.integrations.gemini} onClick={() => ev.run(true)} title={snap.integrations.gemini ? '' : 'needs GEMINI_API_KEY'}>
            {ev.busy ? <span className="shimmer-text">Running…</span> : 'Run with Gemini'}
          </Button>
        </div>
      </div>
      <div className="px-5">
        <ErrorText error={ev.error} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-[11px] tracking-wider text-muted-foreground uppercase">
              <th className="px-5 py-2.5 text-left font-medium">Metric</th>
              <th className="px-5 py-2.5 text-left font-medium">Rules only</th>
              <th className="px-5 py-2.5 text-left font-medium">Gemini + rules</th>
            </tr>
          </thead>
          <tbody className="divide-y border-t">
            {metrics.map(([label, f, isPct]) => (
              <tr key={label}>
                <td className="px-5 py-3 text-muted-foreground">{label}</td>
                {[evalRules, evalModel].map((r, i) => {
                  const v = r ? f(r.heldout) : null
                  const d = r ? f(r.dev) : null
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: two fixed columns
                    <td key={i} className="px-5 py-3">
                      {r == null || v == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : isPct ? (
                        <div className="flex items-center gap-3">
                          <span className="w-10 font-semibold tabular-nums">{pct(v)}</span>
                          <span className="well block h-1.5 w-28 overflow-hidden rounded-full max-sm:hidden">
                            <span className={cn('block h-full rounded-full', i ? 'bg-primary' : 'bg-muted-foreground/50')} style={{ width: `${v * 100}%` }} />
                          </span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">dev {pct(d)}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="w-10 font-semibold tabular-nums">{v}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">dev {d}</span>
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {latest?.misses?.length ? (
        <details className="group border-t px-5 py-3">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {latest.misses.length} misses ({latest.mode})
          </summary>
          <ul className="mt-3 space-y-2">
            {latest.misses.map((m) => (
              <li key={m.text} className="well rounded-xl p-3 text-xs">
                <p className="text-foreground">“{m.text}”</p>
                <p className="mt-1 text-muted-foreground tabular-nums">
                  {m.split} · expected P{m.expected.p} {m.expected.skill}
                  {m.expected.safety ? ` ${m.expected.safety}` : ''} · got P{m.got.p} {m.got.skill}
                  {m.got.safety ? ` ${m.got.safety}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  )
}
