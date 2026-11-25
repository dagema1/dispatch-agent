import { createFileRoute } from '@tanstack/react-router'
import { FlaskConical, Play } from 'lucide-react'
import { useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { runEvals, runSimulation } from '#/fns'
import { ErrorText, Muted, PageTitle, Section, Stat } from '#/ui/bits'
import { money } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
    <div>
      <PageTitle title="ROI & simulator" sub="Measured from this system's own event history (last 7 days), plus a controlled day simulation against a human-office baseline." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Median first response"
          value={k.medianResponseSec == null ? '—' : k.medianResponseSec < 90 ? `${Math.round(k.medianResponseSec)} s` : `${Math.round(k.medianResponseSec / 60)} min`}
          hint="industry norm: hours, or a missed call"
          tone="good"
        />
        <Stat label="Requests handled" value={k.requests} hint={`${k.afterHours} after hours · ${pct(k.bookingRate)} booked`} />
        <Stat
          label="Collected / invoiced"
          value={`${money(k.collectedCents)} / ${money(k.invoicedCents)}`}
          hint={k.daysToPaid != null ? `${k.daysToPaid.toFixed(1)} days to paid` : 'no payments yet'}
        />
        <Stat
          label="Office time saved"
          value={`${hoursSaved.toFixed(1)} h`}
          hint={`AI cost at list price: $${aiCost.toFixed(2)} (${(k.tokensIn + k.tokensOut).toLocaleString()} tokens)`}
          tone="good"
        />
      </div>
      <Simulator />
      <Evals />
    </div>
  )
}

function Simulator() {
  const snap = useSnap()
  const [scenario, setScenario] = useState<'normal' | 'cold_snap' | 'heat_wave'>('cold_snap')
  const [n, setN] = useState(120)
  const sim = useAction(() => runSimulation({ data: { scenario, requests: n } }))
  const r = snap.lab.sim
  const rows: Array<[string, (m: NonNullable<typeof r>['ai']) => string, boolean?]> = [
    ['Contacts answered', (m) => `${m.answered}`],
    ['Contacts lost (hang-ups, voicemail)', (m) => `${m.lost}`],
    ['Median time to answer', (m) => `${m.medianResponseMin} min`],
    ['Jobs completed today', (m) => `${m.servedToday}`, true],
    ['Emergencies served today', (m) => `${m.p1ServedToday} / ${m.p1Total}`, true],
    ['Avg emergency wait (request → arrival)', (m) => (m.p1AvgWaitMin == null ? '—' : `${Math.floor(m.p1AvgWaitMin / 60)}h ${m.p1AvgWaitMin % 60}m`)],
    ['Revenue completed today', (m) => money(m.revenueTodayCents), true],
    ['Drive minutes per job', (m) => `${m.driveMinPerJob}`],
    ['Technician utilisation', (m) => pct(m.techUtilisation)],
  ]
  const chart = r
    ? r.ai.servedByHour.map((v, i) => ({
        hour: `${((7 + i) % 12) + 1}${7 + i + 1 < 12 ? 'a' : 'p'}`,
        ai: v,
        human: r.human.servedByHour[i],
      }))
    : []
  return (
    <Section
      className="mb-4"
      title="Day simulator: same demand, same fleet, two operating models"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scenario} onValueChange={(v) => setScenario(v as typeof scenario)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Scenario">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal day</SelectItem>
              <SelectItem value="cold_snap">Cold snap (0°F)</SelectItem>
              <SelectItem value="heat_wave">Heat wave (97°F)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(n)} onValueChange={(v) => setN(Number(v))}>
            <SelectTrigger size="sm" className="w-32" aria-label="Contacts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[60, 120, 200].map((x) => (
                <SelectItem key={x} value={String(x)}>
                  {x} contacts
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={sim.busy} onClick={() => sim.run()}>
            <Play /> {sim.busy ? 'Simulating…' : 'Run'}
          </Button>
        </div>
      }
    >
      <ErrorText error={sim.error} />
      {!r ? (
        <p className="text-sm text-muted-foreground">
          Run a scenario to compare the AI front office with a 1 CSR + 1 dispatcher office (08:00–17:00, first-come-first-served dispatch).
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="overflow-x-auto">
            <Muted className="mb-2 block">
              {r.requests} contacts · {r.scenario.replace('_', ' ')} · {r.outdoorTempF}°F · 5 technicians · simulated in {r.ms} ms
            </Muted>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead className="text-primary">AI front office</TableHead>
                  <TableHead>Human office</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(([label, f, bold]) => (
                  <TableRow key={label}>
                    <TableCell className="text-muted-foreground">{label}</TableCell>
                    <TableCell className={cn('tabular-nums', bold && 'font-semibold text-primary')}>{f(r.ai)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{f(r.human)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Assumptions: humans answer one call at a time (~6 min each); callers hang up after a few minutes on hold; ~45% of after-hours voicemails are never recovered; human
              dispatch is first-come-first-served and only fast-tracks explicit emergencies. The AI re-plans every 15 minutes and never sees a request before it arrives.
            </p>
          </div>
          <div className="h-64">
            <Muted className="mb-1 block">Jobs completed by hour</Muted>
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ left: -20, right: 8, top: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="ai" name="AI front office" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="human" name="Human office" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} strokeDasharray="5 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Section>
  )
}

function Evals() {
  const snap = useSnap()
  const ev = useAction((useModel: boolean) => runEvals({ data: { useModel } }))
  const { evalRules, evalModel } = snap.lab
  const cols = [
    ['Rules only', evalRules],
    ['Gemini + rules', evalModel],
  ] as const
  const metrics: Array<[string, (s: NonNullable<typeof evalRules>['heldout']) => string]> = [
    ['Priority exact', (s) => pct(s.priorityExact)],
    ['Priority within one level', (s) => pct(s.priorityWithinOne)],
    ['Emergency recall (P1 caught)', (s) => pct(s.p1Recall)],
    ['Safety hazard recall', (s) => pct(s.safetyRecall)],
    ['Over-escalated to P1', (s) => `${s.overEscalated}`],
    ['Trade / skill routing', (s) => pct(s.skillAccuracy)],
  ]
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-1.5">
          <FlaskConical className="size-4" /> Triage accuracy evals
        </span>
      }
      right={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={ev.busy} onClick={() => ev.run(false)}>
            Run rules only
          </Button>
          <Button size="sm" disabled={ev.busy || !snap.integrations.gemini} onClick={() => ev.run(true)} title={snap.integrations.gemini ? '' : 'needs GEMINI_API_KEY'}>
            {ev.busy ? 'Running… (rate-limited)' : 'Run with Gemini'}
          </Button>
        </div>
      }
    >
      <ErrorText error={ev.error} />
      <p className="mb-3 text-xs text-muted-foreground">
        45 labelled customer messages (incl. prompt-injection and Spanish). <b>Dev</b> (30) was used to tune the fallback rules; <b>held-out</b> (15) was written afterwards. The
        held-out column is the honest number.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            {cols.map(([l]) => (
              <TableHead key={l} colSpan={2}>
                {l}
              </TableHead>
            ))}
          </TableRow>
          <TableRow>
            <TableHead className="h-6" />
            {cols.flatMap(([l]) => [
              <TableHead key={`${l}d`} className="h-6 text-[11px] font-normal text-muted-foreground">
                dev
              </TableHead>,
              <TableHead key={`${l}h`} className="h-6 text-[11px] font-normal text-muted-foreground">
                held-out
              </TableHead>,
            ])}
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map(([label, f]) => (
            <TableRow key={label}>
              <TableCell className="text-muted-foreground">{label}</TableCell>
              {cols.flatMap(([l, r]) => [
                <TableCell key={`${l}d`} className="tabular-nums text-muted-foreground">
                  {r ? f(r.dev) : '—'}
                </TableCell>,
                <TableCell key={`${l}h`} className="font-medium tabular-nums">
                  {r ? f(r.heldout) : '—'}
                </TableCell>,
              ])}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(evalModel ?? evalRules)?.misses?.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">Misses ({(evalModel ?? evalRules)!.mode})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {(evalModel ?? evalRules)!.misses.map((m) => (
              <li key={m.text} className="text-muted-foreground">
                <span className="text-muted-foreground/70">[{m.split}]</span> “{m.text}” expected P{m.expected.p} {m.expected.skill}
                {m.expected.safety ? ` ${m.expected.safety}` : ''} → got P{m.got.p} {m.got.skill}
                {m.got.safety ? ` ${m.got.safety}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  )
}
