import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Activity, BellRing, CalendarCheck, CircleDollarSign, Inbox, MapPin, RefreshCw, Siren, Snowflake, Sun, UserX, Zap } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { replanNow, setTechActive } from '#/fns'
import type { Snapshot } from '#/server/api/views'
import { Empty, ErrorText, Muted, PageTitle, PriorityTile, Section, Stat } from '#/ui/bits'
import { useConfirm } from '#/ui/confirm'
import { addDays, ago, dayLabel, dayOf, dayTime, minutesOfDay, money, time } from '#/ui/format'
import { JobDialog } from '#/ui/JobDialog'
import { useAction, useLive, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { NeedsYou, waitingP1 } from '#/ui/NeedsYou'
import { RouteTimeline } from '#/ui/RouteTimeline'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const FleetMap = lazy(() => import('#/ui/FleetMap'))

export const Route = createFileRoute('/app/')({ component: Board })

const isLive = (t: Snapshot['techs'][number]) => !!(t.liveAt && Date.now() - new Date(t.liveAt).getTime() < 15 * 60_000 && t.liveLat != null)

function Board() {
  const snap = useSnap()
  const { events } = useLive()
  const [day, setDay] = useState(snap.today)
  const [openId, setOpenId] = useState<number | null>(null)
  const replan = useAction(() => replanNow())
  const toggle = useAction((id: number, active: boolean) => setTechActive({ data: { id, active } }))
  const confirm = useConfirm()
  const askReplan = async () => {
    const ok = await confirm({
      title: 'Re-plan the schedule?',
      description: 'Visits that have not started can move to another technician or time. Emergencies are placed first.',
      confirm: 'Re-plan',
      icon: RefreshCw,
    })
    if (ok) replan.run()
  }
  const askToggle = async (id: number, active: boolean) => {
    const t = snap.techs.find((x) => x.id === id)
    if (!active) {
      const n = snap.jobs.filter((j) => j.technicianId === id && ['scheduled', 'en_route'].includes(j.status)).length
      const ok = await confirm({
        title: `Mark ${t?.name.split(' ')[0] ?? 'technician'} out?`,
        description: n
          ? `${n} upcoming visit${n === 1 ? '' : 's'} will be re-planned onto other technicians. Customers whose time changes are told.`
          : 'They get no new visits until you bring them back.',
        confirm: 'Mark out',
        tone: 'danger',
        icon: UserX,
      })
      if (!ok) return
    }
    toggle.run(id, active)
  }

  const dayJobs = useMemo(() => snap.jobs.filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === day && j.status !== 'cancelled'), [snap.jobs, day])
  const unassigned = snap.jobs.filter((j) => j.status === 'unassigned')
  const isNew = useArrivals(snap.jobs.map((j) => j.id))
  const todays = snap.jobs.filter((j) => j.scheduledStart && dayOf(j.scheduledStart) === snap.today)
  // a P1 is open from the moment it is triaged, whether or not a job exists yet
  const openP1 = snap.jobs.filter((j) => j.priority === 1 && !['done', 'cancelled'].includes(j.status)).length + waitingP1(snap).length
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
              className="inline-flex items-center gap-1.5 rounded-full bg-(--glass) px-3 py-1 text-sm ring-1 ring-border backdrop-blur-md"
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
                {i === 0 ? 'Today' : <DayName day={d} />}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <Button onClick={askReplan} disabled={replan.busy} className="shrink-0 rounded-xl px-4">
          <RefreshCw className={cn(replan.busy && 'animate-spin')} /> Re-plan
        </Button>
      </Dock>
      <ErrorText error={replan.error ?? toggle.error} />
      {/* bento: what needs a person, next to what has no slot yet */}
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <NeedsYou snap={snap} onReplan={askReplan} replanBusy={replan.busy} />
        </div>
        <Section title={`Unassigned (${unassigned.length})`} className="h-full">
          {unassigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every open job has a slot.</p>
          ) : (
            <ul className="-mr-2 max-h-80 space-y-1 overflow-y-auto pr-2">
              {unassigned.map((j) => (
                <li key={j.id}>
                  <button type="button" className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-secondary" onClick={() => setOpenId(j.id)}>
                    <PriorityTile p={j.priority} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{j.title}</span>
                      {+new Date(j.windowEnd) < Date.parse(snap.now) ? (
                        <span className="block truncate text-xs font-medium text-red-600 dark:text-red-400">
                          {j.customer.name} · window missed {dayTime(j.windowEnd)}
                        </span>
                      ) : (
                        <Muted className="block truncate">
                          {j.customer.name} · window ends {dayTime(j.windowEnd)}
                        </Muted>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

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

      <div className="space-y-4">
        <Section title="Technician routes" right={<Muted>{day === snap.today ? 'Today' : dayLabel(day)} · 7am to 7pm</Muted>}>
          <RouteTimeline
            techs={snap.techs}
            jobs={dayJobs}
            isToday={day === snap.today}
            nowMin={nowMin}
            isNew={isNew}
            isLive={isLive}
            onOpen={setOpenId}
            onToggleTech={askToggle}
            toggleBusy={toggle.busy}
          />
        </Section>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-lg font-semibold tracking-tight">Live map</CardTitle>
                <CardDescription>
                  {mapTechs.filter((t) => t.live).length} of {mapTechs.length} technicians sharing location · {dayJobs.length} visits{' '}
                  {day === snap.today ? 'today' : `on ${dayLabel(day)}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative overflow-hidden rounded-2xl ring-1 ring-border">
                  <ClientOnly fallback={<Skeleton className="h-[420px] rounded-none" />}>
                    <Suspense fallback={<Skeleton className="h-[420px] rounded-none" />}>
                      <FleetMap techs={mapTechs} jobs={mapJobs} routes={routes} height={420} />
                    </Suspense>
                  </ClientOnly>
                  <span className="pointer-events-none absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-(--glass-strong) backdrop-blur-md px-2.5 py-1 text-xs font-medium ring-1 ring-border">
                    <MapPin className="size-3.5" /> Denver metro
                  </span>
                  <MapInsight unassigned={unassigned.length} openP1={openP1} />
                </div>
              </CardContent>
            </Card>
          </div>
          <Section
            className="h-full"
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
      <JobDialog job={open} onClose={() => setOpenId(null)} />
    </div>
  )
}

const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  'request.created': (p) => `New ${p.channel} request${p.customer ? ` from ${p.customer}` : ''}: ${p.issue} (P${p.priority})${p.safety ? ` · safety: ${p.safety}` : ''}`,
  'plan.updated': (p) => `Fleet re-planned (${p.reason}): ${p.scheduled} scheduled, ${p.moved} moved`,
  'message.sent': (p) => `${p.channel === 'sms' ? 'Text' : 'Message'} to ${p.to}: ${p.subject}${p.delivered ? (p.via === 'test' ? ' (test inbox)' : '') : ' (outbox)'}`,
  'message.tech': (p) => `Telegram to ${p.name}: ${p.preview}`,
  'message.received': (p) => `${p.channel === 'sms' ? 'Text' : 'Email'} from ${p.from}: ${p.preview}`,
  'job.accepted': (p) => `${String(p.name).split(' ')[0]} accepted visit #${p.jobId}`,
  'tech.note': (p) => `${String(p.name).split(' ')[0]} noted on #${p.jobId}: ${p.preview}`,
  'call.reason': (p) =>
    `Call #${p.callId}: ${p.reason === 'status_update' ? 'asking for a status update' : p.reason === 'resume' ? 'calling back after a dropped call' : 'a new problem'}`,
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

/** "Fri, Nov 27" on wide screens, "Fri 27" on phones so the dock fits one row. */
const DayName = ({ day }: { day: string }) => (
  <>
    <span className="sm:hidden">{dayLabel(day).replace(/^(\w+), \w+ (\d+)$/, '$1 $2')}</span>
    <span className="max-sm:hidden">{dayLabel(day)}</span>
  </>
)

/** The floating tool dock, pinned to the bottom of the work area like the reference's canvas toolbar. */
function Dock({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div
      role="toolbar"
      aria-label="Board controls"
      className="slab fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex max-w-[calc(100vw-1.5rem)] items-center justify-between gap-2 overflow-x-auto rounded-full border bg-(--glass-strong) p-1.5 sm:inset-x-auto sm:left-1/2 md:bottom-4 sm:-translate-x-1/2 md:left-[calc(50%+var(--rail,5.75rem)/2)]"
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
    <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-2xl border bg-(--glass-strong) p-3 backdrop-blur-xl shadow-(--slab-shadow)">
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
  if (!shown.length) return <Empty icon={Activity}>Waiting for activity. Try booking from the customer page.</Empty>
  return (
    <ScrollArea className="h-[470px] pr-3">
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
