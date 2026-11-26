import { Link } from '@tanstack/react-router'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  BellRing,
  Bot,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  FileText,
  Inbox,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Navigation,
  Phone,
  Receipt,
  ShieldAlert,
  StickyNote,
  Thermometer,
  Timer,
  TriangleAlert,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { getRequestStory } from '#/fns'
import type { RequestStory as Story } from '#/server/api/story'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Empty, Priority, Status } from './bits'
import { ThreadDialog, TranscriptButton } from './Conversation'
import { AGENT_LABEL, ago, dayOf, dayTime, money, triggerLabel } from './format'
import { useSnap } from './live'
import { Composer } from './NeedsYou'

const CALL_REASON: Record<string, string> = { new_case: 'New problem', status_update: 'Status check', resume: 'Called back after a drop' }
const LABEL = 'text-[11px] font-medium tracking-wider text-muted-foreground uppercase'

/** A request's full history in a side sheet: open it with a request id, close with null. */
export function RequestStorySheet({ requestId, onClose }: { requestId: number | null; onClose: () => void }) {
  return (
    <Sheet open={requestId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {requestId != null && <StoryBody requestId={requestId} />}
      </SheetContent>
    </Sheet>
  )
}

function StoryBody({ requestId }: { requestId: number }) {
  const snap = useSnap()
  // undefined = loading, null = gone
  const [s, setS] = useState<Story | null | undefined>(undefined)
  const [thread, setThread] = useState(false)
  // reload whenever the live snapshot moves, so a tech arriving shows up while the sheet is open
  // biome-ignore lint/correctness/useExhaustiveDependencies: snap is the refresh signal
  useEffect(() => {
    let live = true
    getRequestStory({ data: { requestId } })
      .then((r) => live && setS(r ?? null))
      .catch(() => live && setS(null))
    return () => {
      live = false
    }
  }, [requestId, snap])

  if (s === undefined)
    return (
      <div className="space-y-3 p-5" aria-busy="true">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  if (!s)
    return (
      <div className="p-5">
        <SheetTitle className="sr-only">Request</SheetTitle>
        <Empty>This request is no longer available. Demo resets clear old requests.</Empty>
      </div>
    )

  const r = s.request
  const ex = (r.extracted ?? {}) as { reasons?: string[]; issue?: string; weatherF?: number }
  const c = s.customer
  const job = s.jobs.at(-1)
  const tech = job?.technicianId ? s.techs.find((t) => t.id === job.technicianId) : undefined
  const resp = r.firstResponseAt ? Math.max(0, Math.round((+new Date(r.firstResponseAt) - +new Date(r.createdAt)) / 1000)) : null
  const reasons = (ex.reasons ?? []).filter((x) => !/^model priority/i.test(x))
  const steps = timeline(s)

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="pr-8 text-pretty">{ex.issue ?? r.summary ?? `Request #${r.id}`}</SheetTitle>
        <SheetDescription>
          {c?.name ?? 'Unknown sender'} · by {r.channel === 'voice' ? 'phone' : r.channel} · {dayTime(r.createdAt)}
        </SheetDescription>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Priority p={r.priority} short />
          <Status s={r.status} />
          {r.safetyFlag && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
              <ShieldAlert className="size-3" /> {r.safetyFlag.replaceAll('_', ' ')}
            </span>
          )}
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4 sm:p-5">
        {/* where it stands now */}
        <section className="grid grid-cols-2 gap-2 text-sm">
          <Fact label="Visit" value={job ? job.title : 'Not booked yet'} wide />
          {job && (
            <>
              <Fact label="Window" value={job ? windowText(job.windowStart, job.windowEnd) : '—'} />
              <Fact label="Slot" value={job?.scheduledStart ? `${dayTime(job.scheduledStart)}` : job ? 'Not planned yet' : '—'} />
              <Fact
                label="Technician"
                value={
                  tech ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: tech.color }} /> {tech.name}
                    </span>
                  ) : job ? (
                    'Unassigned'
                  ) : (
                    '—'
                  )
                }
              />
              <Fact label="Visit status" value={job ? <Status s={job.status} /> : '—'} />
            </>
          )}
        </section>

        <section className="space-y-2">
          <h3 className={LABEL}>How it came in</h3>
          <blockquote className="well rounded-xl px-3.5 py-3 text-sm text-pretty whitespace-pre-wrap">{r.rawText}</blockquote>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {resp != null && (
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3.5" /> first reply in {resp < 90 ? `${resp}s` : `${Math.round(resp / 60)} min`}
              </span>
            )}
            {ex.weatherF != null && (
              <span className="inline-flex items-center gap-1">
                <Thermometer className="size-3.5" /> {ex.weatherF}°F outside
              </span>
            )}
          </div>
          {reasons.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Why P{r.priority}:</span> {reasons.join(' · ')}
            </p>
          )}
          {c && (c.phone || c.email) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {c.phone && (
                <Button size="sm" asChild>
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
                    <Phone /> Call {c.name.split(' ')[0]}
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setThread(true)}>
                <MessagesSquare /> Whole conversation
              </Button>
              {c.email && <span className="self-center text-xs text-muted-foreground">{c.email}</span>}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className={LABEL}>History</h3>
          <ol>
            {steps.map((e, i) => (
              <li key={e.key} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span className="absolute top-9 bottom-1 left-[15px] border-l border-dashed border-foreground/20" aria-hidden />}
                <span className={cn('tile size-8 shrink-0 rounded-full', e.tile)}>
                  <e.icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">{e.title}</span>
                    <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums" title={dayTime(e.at)}>
                      {ago(e.at)}
                    </span>
                  </div>
                  {e.detail && <div className="mt-0.5 line-clamp-3 text-xs text-pretty text-muted-foreground">{e.detail}</div>}
                  {e.body}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <ThreadDialog who={thread && c ? { customerId: c.id } : null} onClose={() => setThread(false)} />
        {c && (
          <section className="border-t pt-5">
            <Composer customerId={c.id} requestId={r.id} jobId={job?.id} hasEmail={!!c.email} subject={`Re: ${ex.issue ?? r.summary ?? 'your request'}`} body="" />
          </section>
        )}
      </div>
    </>
  )
}

const Fact = ({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) => (
  <div className={cn('well min-w-0 rounded-xl px-3 py-2', wide && 'col-span-2')}>
    <div className={LABEL}>{label}</div>
    <div className="mt-0.5 truncate">{value}</div>
  </div>
)

const timeOnly = (d: string | Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(new Date(d))
const sameDay = (a: string | Date, b: string | Date) => dayOf(a) === dayOf(b)
/** "Wed, Nov 25, 3:33 PM to 5:00 PM", or both dates when the window crosses midnight. */
const windowText = (a: string | Date, b: string | Date) => `${dayTime(a)} to ${sameDay(a, b) ? timeOnly(b) : dayTime(b)}`

type Step = { key: string; at: string | Date; icon: React.ComponentType<{ className?: string }>; tile: string; title: string; detail?: React.ReactNode; body?: React.ReactNode }

/** Merge the request's records and log into one time-ordered story. */
function timeline(s: Story): Step[] {
  const out: Step[] = []
  const r = s.request
  const techName = (id: unknown) => s.techs.find((t) => t.id === id)?.name ?? 'A technician'
  const types = new Set(s.events.map((e) => e.type))

  // the intake message and the front desk run land a moment around the request row; "came in" leads them
  const firstIn = s.messages.find((m) => m.direction === 'in' && !m.technicianId && Math.abs(+new Date(m.createdAt) - +new Date(r.createdAt)) < 120_000)
  const intakeRuns = s.runs.filter((x) => x.agent === 'front_desk' && Math.abs(+new Date(x.startedAt) - +new Date(r.createdAt)) < 120_000)
  const cameIn = Math.min(+new Date(r.createdAt), ...(firstIn ? [+new Date(firstIn.createdAt)] : []), ...intakeRuns.map((x) => +new Date(x.startedAt)))
  out.push({
    key: 'req',
    at: new Date(cameIn),
    icon: Inbox,
    tile: 'tile-action',
    title: `Came in by ${r.channel === 'voice' ? 'phone' : r.channel}`,
    detail: r.summary ?? undefined,
  })

  for (const m of s.messages) {
    const inbound = m.direction === 'in'
    const fromTech = m.technicianId != null
    // the request's own first message is already the "came in" step
    if (m === firstIn) continue
    out.push({
      key: `m${m.id}`,
      at: m.createdAt,
      icon: fromTech ? StickyNote : inbound ? ArrowDownLeft : ArrowUpRight,
      tile: fromTech ? 'tile-quiet' : inbound ? 'tile-quiet' : m.delivered ? 'tile-action' : 'tile-attn',
      title: fromTech
        ? `${inbound ? `${techName(m.technicianId)} wrote` : `Sent to ${techName(m.technicianId)}`}`
        : inbound
          ? `Customer wrote (${chan(m.channel)})`
          : `We replied (${chan(m.channel)})`,
      detail:
        !inbound && !fromTech
          ? m.delivered
            ? m.via === 'test'
              ? 'Delivered to the test inbox'
              : m.via === 'manual'
                ? 'Marked as told another way'
                : 'Delivered'
            : 'Not delivered'
          : undefined,
      body: <MessageBody subject={m.subject} body={m.channel === 'telegram' ? m.body.replace(/<[^>]+>/g, '') : m.body} />,
    })
  }

  for (const c of s.calls)
    out.push({
      key: `c${c.id}`,
      at: c.startedAt,
      icon: Phone,
      tile: 'tile-action',
      title: `Phone call${c.reason ? ` · ${CALL_REASON[c.reason] ?? c.reason}` : ''}`,
      detail: c.summary ?? `${c.transcript.length} turns${c.endedAt ? ` · ${Math.max(1, Math.round((+new Date(c.endedAt) - +new Date(c.startedAt)) / 60000))} min` : ''}`,
      body: c.transcript.length ? (
        <TranscriptButton className="mt-1.5" turns={c.transcript} title={`Call with ${s.customer?.name ?? 'caller'}`} meta={dayTime(c.startedAt)} />
      ) : undefined,
    })

  for (const j of s.jobs) {
    if (!types.has('job.booked'))
      out.push({
        key: `jb${j.id}`,
        at: j.createdAt,
        icon: CalendarClock,
        tile: 'tile-action',
        title: `Visit booked: ${j.title}`,
        detail: `Window ${windowText(j.windowStart, j.windowEnd)}`,
      })
    // visits planned before assignments were logged: show the current one
    if (j.technicianId && j.scheduledStart && !types.has('job.planned'))
      out.push({
        key: `jp${j.id}`,
        at: new Date(+new Date(j.createdAt) + 1),
        icon: Wrench,
        tile: 'tile-action',
        title: `${techName(j.technicianId)} assigned`,
        detail: `Slot ${dayTime(j.scheduledStart)}`,
      })
    if (j.acceptedAt && !types.has('job.accepted'))
      out.push({ key: `ja${j.id}`, at: j.acceptedAt, icon: UserCheck, tile: 'tile-action', title: `${techName(j.technicianId)} accepted the visit` })
    if (j.completedAt && !types.has('job.completed')) out.push({ key: `jc${j.id}`, at: j.completedAt, icon: CircleCheck, tile: 'tile-action', title: 'Visit completed' })
  }

  for (const e of s.events) {
    const p = e.payload as Record<string, unknown>
    const step = (icon: Step['icon'], tile: string, title: string, detail?: string) => out.push({ key: `e${e.id}`, at: e.createdAt, icon, tile, title, detail })
    switch (e.type) {
      case 'request.created':
        // the "came in" step covers it; add what triage decided
        step(Bot, 'tile-quiet', `Triaged as P${p.priority}`, p.safety ? `Safety: ${String(p.safety).replaceAll('_', ' ')}` : undefined)
        break
      case 'job.booked':
        step(CalendarClock, 'tile-action', `Visit booked: ${p.title}`, `Window ${windowText(p.windowStart as string, p.windowEnd as string)}`)
        break
      case 'job.planned':
        if (p.to)
          step(Wrench, 'tile-action', `${p.tech ?? 'A technician'} assigned`, `Slot ${dayTime(p.to as string)}${p.from ? ` (was ${dayTime(p.from as string)})` : ''} · ${p.reason}`)
        else step(TriangleAlert, 'tile-attn', 'Taken off the schedule', `No technician could fit it (${p.reason})`)
        break
      case 'job.accepted':
        step(UserCheck, 'tile-action', `${p.name} accepted the visit`)
        break
      case 'job.status':
        if (p.status === 'en_route') step(Navigation, 'tile-action', 'Technician on the way', p.eta ? `ETA ${timeOnly(p.eta as string)}` : undefined)
        else if (p.status === 'on_site') step(MapPin, 'tile-action', 'Technician arrived')
        else step(Wrench, 'tile-quiet', `Visit ${String(p.status).replaceAll('_', ' ')}`)
        break
      case 'tech.note':
        if (!s.messages.some((m) => m.technicianId && m.body.startsWith(String(p.preview ?? '').slice(0, 40))))
          step(StickyNote, 'tile-quiet', `${p.name} added a note`, String(p.preview ?? ''))
        break
      case 'message.tech':
        if (!s.messages.some((m) => m.technicianId === p.technicianId && m.direction === 'out'))
          step(MessageSquare, 'tile-quiet', `${p.name} was sent the visit`, p.delivered ? undefined : 'Not delivered (Telegram not linked)')
        break
      case 'job.completed':
        step(CircleCheck, 'tile-action', 'Visit completed', p.totalCents != null ? `Invoice ${money(p.totalCents as number, 2)}` : undefined)
        break
      case 'job.cancelled':
        step(Ban, 'tile-red', 'Visit cancelled')
        break
      case 'invoice.sent':
        step(Receipt, 'tile-action', `Invoice sent · ${money(p.totalCents as number, 2)}`)
        break
      case 'invoice.paid':
        step(Receipt, 'tile-action', `Invoice paid · ${money(p.totalCents as number, 2)}`)
        break
      case 'quote.created':
        step(FileText, 'tile-action', 'Photo quote sent', Array.isArray(p.tiers) ? (p.tiers as number[]).map((t) => money(t)).join(' · ') : undefined)
        break
      case 'quote.accepted':
        step(FileText, 'tile-action', `Quote accepted · ${p.tier}`, money(p.totalCents as number))
        break
      case 'sla.breach':
        step(BellRing, 'tile-attn', 'No reply in time', 'The office was alerted')
        break
      case 'request.resolved':
        step(CircleCheck, 'tile-quiet', 'You marked it handled', (p.note as string) || undefined)
        break
    }
  }

  for (const run of s.runs)
    out.push({
      key: `r${run.id}`,
      at: run.startedAt,
      icon: Bot,
      tile: 'tile-quiet',
      title: `${AGENT_LABEL[run.agent] ?? run.agent} agent · ${triggerLabel(run.trigger)}`,
      detail: (
        <>
          {run.outcome ?? run.status}{' '}
          <Link to="/app/agents" search={{ run: run.id }} className="inline-flex items-center font-medium text-foreground underline-offset-2 hover:underline">
            Trace <ChevronRight className="size-3" />
          </Link>
        </>
      ),
    })

  return out.sort((a, b) => +new Date(a.at) - +new Date(b.at))
}

const chan = (c: string) => (c === 'sms' ? 'text' : c === 'voice' ? 'phone' : c)

function MessageBody({ subject, body }: { subject: string | null; body: string }) {
  const [open, setOpen] = useState(false)
  const long = body.length > 180
  return (
    <div className="well mt-1.5 rounded-xl px-3 py-2 text-xs leading-relaxed">
      {subject && <div className="mb-0.5 font-medium text-foreground">{subject}</div>}
      <p className={cn('whitespace-pre-wrap text-foreground/85', !open && long && 'line-clamp-3')}>{body}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 font-medium text-muted-foreground hover:text-foreground">
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}
