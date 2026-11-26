import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Activity, BellRing, CalendarCheck, Check, CircleDollarSign, Inbox, MapPin, RefreshCw, Siren, Snowflake, Sun, Truck, UserX, Wrench, Zap } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { completeJob, replanNow, setTechActive } from '#/fns'
import type { Snapshot } from '#/server/api/views'
import { ErrorText, Muted, PageTitle, Priority, Section, Stat, Status } from '#/ui/bits'
import { addDays, ago, dayLabel, dayOf, dayTime, minutesOfDay, money, time } from '#/ui/format'
import { useAction, useLive, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
const HOURS = Array.from({ length: 13 }, (_, i) => 7 + i) // 7am..7pm axis labels
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
  const isNew = useArrivals(snap.jobs.map((j) => j.id))
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
        right={
          w ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm ring-1 ring-border"
              title={w.override ? 'Demo weather override on' : 'Open-Meteo'}
            >
              {w.tempC <= 0 ? <Snowflake className="size-4 text-muted-foreground" /> : <Sun className="size-4 text-muted-foreground" />}
              <span className="tabular-nums">{Math.round((w.tempC * 9) / 5 + 32)}°F</span>
              <span className="text-muted-foreground">Denver{w.override ? ' · demo' : ''}</span>
            </span>
          ) : null
        }
      />
      <Dock>
        <ToggleGroup type="single" variant="outline" size="sm" value={day} onValueChange={(v) => v && setDay(v)} aria-label="Day shown">
          {[0, 1, 2].map((i) => {
            const d = addDays(snap.today, i)
            return (
              <ToggleGroupItem key={d} value={d} className="px-3">
                {i === 0 ? 'Today' : dayLabel(d)}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <Button onClick={() => replan.run()} disabled={replan.busy} className="rounded-xl px-4">
          <RefreshCw className={cn(replan.busy && 'animate-spin')} /> Re-plan
        </Button>
      </Dock>
      <ErrorText error={replan.error ?? toggle.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label="Visits today"
          icon={CalendarCheck}
          value={todays.length}
          hint={`${todays.filter((j) => j.status === 'done').length} done so far`}
          ratio={todays.length ? todays.filter((j) => j.status === 'done').length / todays.length : 0}
        />
        <Stat label="Booked value today" icon={CircleDollarSign} value={money(todays.reduce((a, j) => a + j.estValueCents, 0))} hint="estimated, before upsells" />
        <Stat label="Open emergencies" icon={Siren} value={openP1} tone={openP1 ? 'bad' : 'good'} hint={openP1 ? 'jump the queue on re-plan' : 'none waiting'} />
        <Stat
          label="Unassigned"
          icon={Inbox}
          value={unassigned.length}
          tone={unassigned.length ? 'warn' : 'good'}
          hint={unassigned.length ? 'need a slot or a decision' : 'everything has a slot'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Section title="Technician routes" right={<Muted>{day === snap.today ? 'Today' : dayLabel(day)} · 7am to 7pm</Muted>}>
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="relative ml-36 h-5 text-[10px] text-muted-foreground">
                  {HOURS.map((h) => (
                    <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h * 60) }}>
                      {((h - 1) % 12) + 1}
                      {h < 12 ? 'a' : 'p'}
                    </span>
                  ))}
                </div>
                {snap.techs.map((t) => {
                  const jobs = dayJobs.filter((j) => j.technicianId === t.id)
                  return (
                    <div key={t.id} className="group/row flex items-center py-1">
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
                          className={cn(
                            'h-auto px-0 text-[11px]',
                            t.active
                              ? 'text-muted-foreground opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-destructive [@media(hover:none)]:opacity-100'
                              : 'font-medium text-destructive',
                          )}
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
                      <div className={cn('well relative h-12 flex-1 rounded-lg', !t.active && 'opacity-50')}>
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
                                'job-block absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-left text-[11px] leading-tight text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.3),0_2px_6px_-1px_oklch(0_0_0/0.4)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                j.status === 'done' && 'opacity-45',
                                isNew(j.id) && 'arrive-pop',
                                j.priority === 1 && 'outline-2 outline-offset-1 outline-red-500',
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
                              <div className="flex items-center gap-1 truncate opacity-90">
                                {time(j.scheduledStart)} · {j.customer.name.split(' ')[0]}
                                {j.status === 'en_route' ? (
                                  <Truck className="size-3 shrink-0" aria-label="on the way" />
                                ) : j.status === 'on_site' ? (
                                  <Wrench className="size-3 shrink-0" aria-label="on site" />
                                ) : j.status === 'done' ? (
                                  <Check className="size-3 shrink-0" aria-label="done" />
                                ) : null}
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

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold tracking-tight">Live map</CardTitle>
              <CardDescription>
                {mapTechs.filter((t) => t.live).length} of {mapTechs.length} technicians sharing location · {dayJobs.length} visits{' '}
                {day === snap.today ? 'today' : `on ${dayLabel(day)}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative overflow-hidden rounded-2xl ring-1 ring-border">
                <ClientOnly fallback={<Skeleton className="h-[400px] rounded-none" />}>
                  <Suspense fallback={<Skeleton className="h-[400px] rounded-none" />}>
                    <FleetMap techs={mapTechs} jobs={mapJobs} routes={routes} height={400} />
                  </Suspense>
                </ClientOnly>
                <span className="pointer-events-none absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium ring-1 ring-border">
                  <MapPin className="size-3.5" /> Denver metro
                </span>
                <MapInsight unassigned={unassigned.length} openP1={openP1} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Section title={`Unassigned (${unassigned.length})`}>
            {unassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every open job has a slot.</p>
            ) : (
              <ul className="space-y-2">
                {unassigned.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-secondary"
                      onClick={() => setOpenId(j.id)}
                    >
                      <span className={cn('tile size-8 shrink-0 text-[11px] font-semibold', j.priority === 1 ? 'tile-red' : 'tile-attn')}>P{j.priority}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{j.title}</span>
                        <Muted className="block truncate">
                          {j.customer.name} · window ends {dayTime(j.windowEnd)}
                        </Muted>
                      </span>
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
  'request.created': (p) => `New ${p.channel} request${p.customer ? ` from ${p.customer}` : ''}: ${p.issue} (P${p.priority})${p.safety ? ` · safety: ${p.safety}` : ''}`,
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
  'invoice.paid': (p) => `Invoice #${p.invoiceId} paid (${money(Number(p.totalCents))})`,
  'owner.alert': (p) => `Owner alert: ${p.text}`,
  'tech.location': (p) => `Live location from tech #${p.technicianId}`,
  'agent.run_finished': (p) => `${p.agent} agent: ${p.outcome ?? p.status}`,
  'campaign.sent': (p) => `Campaign sent to ${p.recipients} customers`,
  'sla.breach': (p) => `SLA breach on request #${p.requestId}`,
}

/** Events that ask the owner to look or decide get the gold tile; everything the agents did alone stays quiet. */
const NEEDS_PERSON = new Set(['approval.requested', 'owner.alert', 'sla.breach'])

/** The floating tool dock, pinned to the bottom of the work area like the reference's canvas toolbar. */
function Dock({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div
      role="toolbar"
      aria-label="Board controls"
      className="slab fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-2 overflow-x-auto rounded-2xl border bg-popover p-1.5 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 md:left-[calc(50%+var(--rail,4.5rem)/2)]"
    >
      {children}
    </div>,
    document.body,
  )
}

/** One line of judgement floating over the map, like a dispatcher looking over your shoulder. */
function MapInsight({ unassigned, openP1 }: { unassigned: number; openP1: number }) {
  const msg =
    openP1 > 0
      ? { title: `${openP1} emergenc${openP1 === 1 ? 'y' : 'ies'} open`, sub: 'Emergencies jump the queue on the next re-plan.' }
      : unassigned > 0
        ? { title: `${unassigned} visit${unassigned === 1 ? '' : 's'} without a slot`, sub: 'Re-plan from the dock to fit them in.' }
        : { title: 'Every visit has a slot', sub: 'Routes are re-planned automatically on every change.' }
  return (
    <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-2xl border bg-popover/95 p-3 shadow-(--slab-shadow)">
      <span className={cn('tile size-9 shrink-0 rounded-full', openP1 ? 'tile-red' : 'tile-quiet')}>
        <Zap className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{msg.title}</div>
        <div className="truncate text-xs text-muted-foreground">{msg.sub}</div>
      </div>
    </div>
  )
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
  const isNew = useArrivals(shown.map((e) => e.id))
  if (!shown.length) return <p className="text-sm text-muted-foreground">Waiting for activity… try booking from the customer page.</p>
  return (
    <ScrollArea className="h-[520px] pr-3">
      <ul className="space-y-1.5">
        {shown.map((e) => {
          const person = NEEDS_PERSON.has(e.type)
          const Icon = person ? BellRing : Zap
          return (
            <li key={e.id} className={cn('-mx-1.5 flex gap-2.5 rounded-lg px-1.5 py-1 text-xs', isNew(e.id) && 'arrive')}>
              <span className={cn('tile mt-0.5 size-6 shrink-0', person ? 'tile-attn' : 'tile-quiet')}>
                <Icon className="size-3" />
              </span>
              <span className="min-w-0">
                <span className="block">{EVENT_TEXT[e.type](e.payload)}</span>
                <span className="block text-[11px] text-muted-foreground">{ago(e.createdAt)}</span>
              </span>
            </li>
          )
        })}
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
              Customer tracking page
            </a>
          </Button>
          {quote && (
            <Button variant="outline" size="sm" asChild>
              <a href={quote.url} target="_blank" rel="noreferrer">
                Quote #{quote.id}
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
