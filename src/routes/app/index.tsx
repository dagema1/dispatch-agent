import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Activity, MapPin, RefreshCw, Snowflake, Sun, UserX } from 'lucide-react'
import { Suspense, lazy, useMemo, useState } from 'react'
import { completeJob, replanNow, setTechActive } from '#/fns'
import type { Snapshot } from '#/server/api/views'
import { ErrorText, Muted, PageTitle, Priority, Section, Stat, Status } from '#/ui/bits'
import { addDays, ago, dayLabel, dayOf, dayTime, minutesOfDay, money, time } from '#/ui/format'
import { useAction, useLive, useSnap } from '#/ui/live'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const FleetMap = lazy(() => import('#/ui/FleetMap'))

export const Route = createFileRoute('/app/')({ component: Board })

type Job = Snapshot['jobs'][number]
const START = 7 * 60
const END = 19 * 60
const pct = (m: number) => `${(Math.min(Math.max(m - START, 0), END - START) / (END - START)) * 100}%`
const isLive = (t: Snapshot['techs'][number]) => !!(t.liveAt && Date.now() - new Date(t.liveAt).getTime() < 15 * 60_000 && t.liveLat != null)

function Board() {
  const snap = useSnap()
  const { events } = useLive()
  const [day, setDay] = useState(snap.today)
  const [openId, setOpenId] = useState<number | null>(null)
  const replan = useAction(() => replanNow())
  const toggle = useAction((id: number, active: boolean) => setTechActive({ data: { id, active } }))

  const dayJobs = useMemo(() => snap.jobs.filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === day && j.status !== 'cancelled'), [snap.jobs, day])
  const unassigned = snap.jobs.filter((j) => j.status === 'unassigned')
  const todays = snap.jobs.filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === snap.today)
  const openP1 = snap.jobs.filter((j) => j.priority === 1 && !['done', 'cancelled'].includes(j.status)).length
  const nowMin = minutesOfDay(snap.now)
  const w = snap.weather
  const open = openId != null ? (snap.jobs.find((j) => j.id === openId) ?? null) : null

  const mapTechs = snap.techs
    .filter((t) => t.active)
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      lat: isLive(t) ? t.liveLat! : t.homeLat,
      lng: isLive(t) ? t.liveLng! : t.homeLng,
      live: isLive(t),
    }))
  const colorOf = (id: number | null) => snap.techs.find((t) => t.id === id)?.color ?? '#94a3b8'
  const mapJobs = dayJobs
    .filter((j) => j.customer.lat != null)
    .map((j) => ({
      id: j.id,
      lat: j.customer.lat!,
      lng: j.customer.lng!,
      color: colorOf(j.technicianId),
      priority: j.priority,
      label: `#${j.id} ${time(j.scheduledStart)} · ${j.title} · ${j.customer.name}`,
    }))
  const routes = snap.techs.map((t) => {
    const stops = dayJobs.filter((j) => j.technicianId === t.id && j.customer.lat != null).sort((a, b) => +new Date(a.scheduledStart!) - +new Date(b.scheduledStart!))
    const home = mapTechs.find((m) => m.id === t.id)
    return {
      color: t.color,
      points: [...(home ? [[home.lat, home.lng] as [number, number]] : []), ...stops.map((s) => [s.customer.lat!, s.customer.lng!] as [number, number])],
    }
  })

  return (
    <div>
      <PageTitle
        title="Dispatch board"
        sub="The dispatch agent re-plans the whole fleet on every new request, delay or cancellation."
        right={
          <Button onClick={() => replan.run()} disabled={replan.busy}>
            <RefreshCw className={cn(replan.busy && 'animate-spin')} /> Re-plan now
          </Button>
        }
      />
      <ErrorText error={replan.error ?? toggle.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Visits today" value={todays.length} hint={`${todays.filter((j) => j.status === 'done').length} done`} />
        <Stat label="Booked value today" value={money(todays.reduce((a, j) => a + j.estValueCents, 0))} />
        <Stat label="Open emergencies" value={openP1} tone={openP1 ? 'bad' : 'good'} />
        <Stat
          label="Unassigned"
          value={unassigned.length}
          tone={unassigned.length ? 'warn' : 'good'}
          hint={unassigned.length ? 'needs a slot or a decision' : 'everything has a slot'}
        />
        <Stat
          label="Weather (Denver)"
          value={
            w ? (
              <span className="inline-flex items-center gap-1">
                {w.tempC <= 0 ? <Snowflake className="size-4 text-sky-500" /> : <Sun className="size-4 text-amber-500" />}
                {Math.round((w.tempC * 9) / 5 + 32)}°F
              </span>
            ) : (
              '—'
            )
          }
          hint={w?.override ? 'demo override on' : 'Open-Meteo'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Section
            title="Technician routes"
            right={
              <ToggleGroup type="single" variant="outline" size="sm" value={day} onValueChange={(v) => v && setDay(v)}>
                {[0, 1, 2].map((i) => {
                  const d = addDays(snap.today, i)
                  return (
                    <ToggleGroupItem key={d} value={d} className="px-3">
                      {i === 0 ? 'Today' : dayLabel(d)}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            }
          >
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="relative ml-36 h-5 text-[10px] text-muted-foreground">
                  {Array.from({ length: 13 }, (_, i) => (
                    <span key={i} className="absolute -translate-x-1/2" style={{ left: pct(START + i * 60) }}>
                      {((7 + i - 1) % 12) + 1}
                      {7 + i < 12 ? 'a' : 'p'}
                    </span>
                  ))}
                </div>
                {snap.techs.map((t) => {
                  const jobs = dayJobs.filter((j) => j.technicianId === t.id)
                  return (
                    <div key={t.id} className="flex items-center border-t py-1.5">
                      <div className="w-36 shrink-0 pr-2">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                          {t.name.split(' ')[0]}
                          {isLive(t) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <MapPin className="size-3 text-emerald-600" />
                              </TooltipTrigger>
                              <TooltipContent>Sharing live location</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {t.level === 'senior' ? 'Senior · ' : ''}
                          {t.skills
                            .map((s) => s.split('_')[0])
                            .filter((s, i, a) => a.indexOf(s) === i)
                            .join(', ')}
                        </div>
                        <Button
                          variant="link"
                          size="xs"
                          className={cn('h-auto px-0 text-[11px]', t.active ? 'text-muted-foreground hover:text-destructive' : 'font-medium text-destructive')}
                          onClick={() => toggle.run(t.id, !t.active)}
                          disabled={toggle.busy}
                        >
                          {t.active ? (
                            <>
                              <UserX /> mark out
                            </>
                          ) : (
                            'OUT · bring back'
                          )}
                        </Button>
                      </div>
                      <div className={cn('relative h-12 flex-1 rounded-md', t.active ? 'bg-muted/60' : 'bg-destructive/5')}>
                        {day === snap.today && nowMin > START && nowMin < END && <div className="absolute inset-y-0 z-10 w-px bg-destructive/70" style={{ left: pct(nowMin) }} />}
                        {jobs.map((j) => {
                          const s = minutesOfDay(j.scheduledStart!)
                          const e = j.scheduledEnd ? minutesOfDay(j.scheduledEnd) : s + j.durationMin
                          return (
                            <button
                              type="button"
                              key={j.id}
                              onClick={() => setOpenId(j.id)}
                              title={`${j.title} · ${j.customer.name}`}
                              className={cn(
                                'absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-left text-[11px] leading-tight text-white shadow-sm ring-1 ring-black/10 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                j.status === 'done' && 'opacity-45',
                                j.priority === 1 && 'ring-2 ring-red-500 ring-offset-1 ring-offset-background',
                              )}
                              style={{
                                left: pct(s),
                                width: `calc(${pct(e)} - ${pct(s)})`,
                                background: t.color,
                              }}
                            >
                              <div className="truncate font-semibold">
                                {j.priority <= 2 ? `P${j.priority} ` : ''}
                                {j.title}
                              </div>
                              <div className="truncate opacity-90">
                                {time(j.scheduledStart)} · {j.customer.name.split(' ')[0]}{' '}
                                {j.status === 'en_route' ? '🚐' : j.status === 'on_site' ? '🔧' : j.status === 'done' ? '✓' : ''}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Section>

          <Section title={`Map · ${day === snap.today ? 'today' : dayLabel(day)}`} right={<Muted>dashed line = planned route order</Muted>}>
            <ClientOnly fallback={<Skeleton className="h-[360px] rounded-xl" />}>
              <Suspense fallback={<Skeleton className="h-[360px] rounded-xl" />}>
                <FleetMap techs={mapTechs} jobs={mapJobs} routes={routes} />
              </Suspense>
            </ClientOnly>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={`Unassigned (${unassigned.length})`}>
            {unassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every open job has a slot.</p>
            ) : (
              <ul className="space-y-2">
                {unassigned.map((j) => (
                  <li key={j.id}>
                    <button type="button" className="w-full rounded-lg border p-2 text-left transition-colors hover:bg-muted" onClick={() => setOpenId(j.id)}>
                      <div className="flex items-center gap-1.5">
                        <Priority p={j.priority} short /> <span className="truncate text-sm font-medium">{j.title}</span>
                      </div>
                      <Muted className="mt-0.5 block">
                        {j.customer.name} · window ends {dayTime(j.windowEnd)}
                      </Muted>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section
            title={
              <span className="inline-flex items-center gap-1.5">
                <Activity className="size-3.5" /> Live activity
              </span>
            }
          >
            <Feed events={events} />
          </Section>
        </div>
      </div>
      <JobSheet job={open} onClose={() => setOpenId(null)} />
    </div>
  )
}

const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  'request.created': (p) => `New ${p.channel} request${p.customer ? ` from ${p.customer}` : ''}: ${p.issue} (P${p.priority})${p.safety ? ` ⚠ ${p.safety}` : ''}`,
  'plan.updated': (p) => `Fleet re-planned (${p.reason}): ${p.scheduled} scheduled, ${p.moved} moved`,
  'message.sent': (p) => `Message to ${p.to}: ${p.subject}${p.delivered ? '' : ' (outbox)'}`,
  'message.tech': (p) => `Telegram to ${p.name}: ${p.preview}`,
  'approval.requested': (p) => `Approval needed: ${p.summary}`,
  'approval.decided': (p) => `${p.decision}: ${p.summary}`,
  'quote.created': (p) => `Quote #${p.quoteId} built${p.replacementLead ? ' · replacement lead' : ''}`,
  'quote.accepted': (p) => `Quote #${p.quoteId} accepted (${p.tier})`,
  'job.status': (p) => `Job #${p.jobId} → ${String(p.status).replace('_', ' ')}`,
  'job.completed': (p) => `Job #${p.jobId} completed, invoice #${p.invoiceId}`,
  'invoice.sent': (p) => `Invoice #${p.invoiceId} sent (${money(Number(p.totalCents))})`,
  'invoice.paid': (p) => `💰 Invoice #${p.invoiceId} paid (${money(Number(p.totalCents))})`,
  'owner.alert': (p) => `Owner alert: ${p.text}`,
  'tech.location': (p) => `Live location from tech #${p.technicianId}`,
  'agent.run_finished': (p) => `${p.agent} agent: ${p.outcome ?? p.status}`,
  'campaign.sent': (p) => `Campaign sent to ${p.recipients} customers`,
  'sla.breach': (p) => `SLA breach on request #${p.requestId}`,
}

function Feed({
  events,
}: {
  events: Array<{
    id: number
    type: string
    payload: Record<string, unknown>
    createdAt: string
  }>
}) {
  const shown = events.filter((e) => EVENT_TEXT[e.type]).slice(0, 25)
  if (!shown.length) return <p className="text-sm text-muted-foreground">Waiting for activity… try booking from the customer page.</p>
  return (
    <ScrollArea className="h-[520px] pr-3">
      <ul className="space-y-2.5">
        {shown.map((e) => (
          <li key={e.id} className="text-xs">
            <div>{EVENT_TEXT[e.type](e.payload)}</div>
            <div className="text-[10px] text-muted-foreground">{ago(e.createdAt)}</div>
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}

function JobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  return (
    <Sheet open={!!job} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">{job && <JobDetail key={job.id} job={job} />}</SheetContent>
    </Sheet>
  )
}

function JobDetail({ job }: { job: Job }) {
  const snap = useSnap()
  const [note, setNote] = useState('')
  const done = useAction(() => completeJob({ data: { jobId: job.id, note } }))
  const tech = snap.techs.find((t) => t.id === job.technicianId)
  const quote = snap.quotes.find((q) => q.jobId === job.id)
  const invoice = snap.invoices.find((i) => i.jobId === job.id)
  const report = job.report as { workDone?: string; followUp?: string } | null
  const rows: Array<[string, React.ReactNode]> = [
    [
      'Customer',
      <>
        {job.customer.name}
        <Muted className="block">{job.customer.address}</Muted>
      </>,
    ],
    ['Technician', tech?.name ?? '—'],
    ['Planned', `${dayTime(job.scheduledStart)} – ${time(job.scheduledEnd)}`],
    ['Customer window', `${dayTime(job.windowStart)} – ${dayTime(job.windowEnd)}`],
    ...(job.etaAt ? ([['Live ETA', time(job.etaAt)]] as Array<[string, React.ReactNode]>) : []),
    ['Est. value', money(job.estValueCents)],
  ]
  return (
    <>
      <SheetHeader>
        <SheetDescription>Job #{job.id}</SheetDescription>
        <SheetTitle className="text-lg">{job.title}</SheetTitle>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Priority p={job.priority} /> <Status s={job.status} />
          <Badge variant="secondary">{job.skill.replace('_', ' ')}</Badge>
        </div>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-6">
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={job.trackUrl} target="_blank" rel="noreferrer">
              Customer tracking page ↗
            </a>
          </Button>
          {quote && (
            <Button variant="outline" size="sm" asChild>
              <a href={quote.url} target="_blank" rel="noreferrer">
                Quote #{quote.id} ↗
              </a>
            </Button>
          )}
        </div>
        {report?.workDone && (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
            <div className="font-medium text-emerald-800 dark:text-emerald-300">Job report</div>
            <p className="mt-1">{report.workDone}</p>
            {report.followUp && <p className="mt-1 text-xs text-muted-foreground">Next: {report.followUp}</p>}
          </div>
        )}
        {invoice && (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Invoice #{invoice.id}</span> <Status s={invoice.status} />
            </div>
            <div className="mt-1 text-muted-foreground">{money(invoice.totalCents, 2)}</div>
            {invoice.payUrl && (
              <Button variant="link" size="xs" className="h-auto px-0" asChild>
                <a href={invoice.payUrl} target="_blank" rel="noreferrer">
                  Stripe payment link (test mode)
                </a>
              </Button>
            )}
          </div>
        )}
        {!['done', 'cancelled'].includes(job.status) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="close-note">Close the job</Label>
              <p className="text-xs text-muted-foreground">Technicians normally send a voice note to the Telegram bot (/done). You can type the same note here.</p>
              <Textarea
                id="close-note"
                rows={3}
                placeholder="Replaced the igniter, cleaned the flame sensor, furnace running fine. Customer declined duct cleaning."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button disabled={done.busy || note.length < 3} onClick={() => done.run()}>
                {done.busy ? 'Writing report & invoice…' : 'Complete → report → invoice'}
              </Button>
              <ErrorText error={done.error} />
            </div>
          </>
        )}
      </div>
    </>
  )
}
