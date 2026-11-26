import { createFileRoute } from '@tanstack/react-router'
import { ChevronRight, Globe, Inbox, Mail, MessageSquare, Phone, Send, ShieldAlert, Wrench } from 'lucide-react'
import { useState } from 'react'
import { simulateEmail } from '#/fns'
import { Empty, ErrorText, Muted, PageTitle, Priority, Status } from '#/ui/bits'
import { ThreadDialog, TranscriptDialog } from '#/ui/Conversation'
import { ago, dayTime } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { Avatar } from '#/ui/people'
import { RequestStorySheet } from '#/ui/RequestStory'
import { SegmentedNav, TabPanel } from '#/ui/SegmentedNav'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/inbox')({
  component: InboxPage,
  // ?request=<id> opens that request's full history (deep link from the board)
  validateSearch: (s: Record<string, unknown>): { request?: number } => (Number.isInteger(Number(s.request)) && s.request != null ? { request: Number(s.request) } : {}),
})

const SAMPLES = [
  {
    name: 'Dana Whitfield',
    email: 'dana.whitfield@example.com',
    subject: 'No heat!!',
    body: "Our furnace stopped working overnight and it's 58 inside. My mom (84) lives with us. We're at 1420 S Pearl St, Denver CO 80210. Phone 720-555-0199.",
  },
  {
    name: 'Marcus Lee',
    email: 'marcus.lee@example.com',
    subject: 'Water heater leaking',
    body: 'Water heater in the garage is leaking from the bottom, small puddle growing. 3155 W 38th Ave, Denver CO 80211. Any time today works.',
  },
  {
    name: 'Priya Natarajan',
    email: 'priya.n@example.com',
    subject: 'Smell of gas',
    body: 'There is a strong gas smell near our furnace in the basement. 2290 Krameria St, Denver CO 80207.',
  },
  {
    name: 'Ellen Brooks',
    email: 'ellen.brooks@example.com',
    subject: 'Quote for new AC',
    body: 'Our AC is 19 years old, we would like a quote for a replacement sometime next week. 6120 E Bates Ave, Denver CO 80222.',
  },
]

type Filter = 'all' | 'urgent' | 'open'
const INBOX_TABS = ['requests', 'messages', 'calls'] as const
type InboxTab = (typeof INBOX_TABS)[number]

function InboxPage() {
  const snap = useSnap()
  const [tab, setTab] = useState<InboxTab>('requests')
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title="Requests" sub="Every customer request, message and call, with its full history." right={<TestEmailButton />} />
      <SegmentedNav
        label="Inbox sections"
        className="mb-2"
        active={tab}
        onSelect={(k) => setTab(k as InboxTab)}
        items={[
          { key: 'requests', label: 'Requests', icon: Inbox, count: snap.requests.length },
          { key: 'messages', label: 'Messages', icon: MessageSquare, count: snap.messages.length },
          { key: 'calls', label: 'Calls', icon: Phone, count: snap.calls.length },
        ]}
      />
      <TabPanel order={INBOX_TABS} active={tab}>
        {tab === 'requests' ? <Requests /> : tab === 'messages' ? <Messages /> : <Calls />}
      </TabPanel>
    </div>
  )
}

const channelIcon = (c: string) => (c === 'voice' ? Phone : c === 'email' ? Mail : c === 'web' ? Globe : MessageSquare)
const OPEN = ['new', 'triaged', 'awaiting_customer']

function Requests() {
  const snap = useSnap()
  const open = Route.useSearch().request ?? null
  const navigate = Route.useNavigate()
  const setOpen = (id: number | null) => navigate({ search: id == null ? {} : { request: id }, replace: true })
  const [filter, setFilter] = useState<Filter>('all')
  const isNew = useArrivals(snap.requests.map((r) => r.id))
  const rows = snap.requests.filter((r) => (filter === 'urgent' ? (r.priority ?? 9) <= 2 || !!r.safetyFlag : filter === 'open' ? OPEN.includes(r.status) : true))
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="all" className="px-3 text-xs">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="urgent" className="px-3 text-xs">
            Urgent &amp; safety
          </ToggleGroupItem>
          <ToggleGroupItem value="open" className="px-3 text-xs">
            Needs follow-up
          </ToggleGroupItem>
        </ToggleGroup>
        {filter !== 'all' && <Muted>{rows.length} shown</Muted>}
      </div>
      {rows.length === 0 ? (
        <Empty>{snap.requests.length ? 'Nothing matches this filter.' : 'No requests yet. Book from the customer page or send a test email.'}</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const ex = (r.extracted ?? {}) as { reasons?: string[]; issue?: string; weatherF?: number }
            const cust = r.customerId ? snap.customers[r.customerId] : null
            const name = cust?.name ?? null
            return (
              <li key={r.id} className={cn(isNew(r.id) && 'arrive')}>
                <button
                  type="button"
                  onClick={() => setOpen(r.id)}
                  aria-label={`Open history: ${ex.issue ?? r.summary ?? 'request'} from ${name ?? 'unknown sender'}`}
                  className="grid w-full cursor-pointer text-left outline-none focus-visible:bg-foreground/5 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-4 transition-colors hover:bg-secondary/50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5"
                >
                  <SenderAvatar name={name ?? '?'} c={r.channel} p={r.priority} />
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{name ?? 'Unknown sender'}</span>
                      <Muted className="shrink-0 whitespace-nowrap sm:hidden">{ago(r.createdAt)}</Muted>
                    </div>
                    <div className="truncate text-sm">{ex.issue ?? r.summary ?? 'Request'}</div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.rawText}</p>
                  </div>
                  {/* phone: badges wrap under the text; wider: a right-hand column */}
                  <div className="col-start-2 flex flex-col gap-1 sm:col-start-auto sm:items-end">
                    <Muted className="hidden whitespace-nowrap sm:block">{ago(r.createdAt)}</Muted>
                    <div className="flex flex-wrap gap-1 sm:justify-end">
                      {r.safetyFlag && (
                        <Badge variant="destructive">
                          <ShieldAlert /> {r.safetyFlag.replaceAll('_', ' ')}
                        </Badge>
                      )}
                      <Priority p={r.priority} short />
                      <Status s={r.status} />
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <RequestStorySheet requestId={open} onClose={() => setOpen(null)} />
    </Card>
  )
}

/** Who sent it, with the channel it came in on as a small badge. Emergencies get a red ring. */
const SenderAvatar = ({ name, c, p }: { name: string; c: string; p: number | null }) => {
  const I = channelIcon(c)
  return (
    <span role="img" aria-label={`${name} via ${c}`} title={`via ${c}`} className="self-start">
      <Avatar name={name} className={cn(p === 1 && 'ring-2 ring-destructive')} badge={<I className="size-2.5" />} />
    </span>
  )
}

const ChannelTag = ({ c }: { c: string }) => {
  const I = channelIcon(c)
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground capitalize">
      <I className="size-3" /> {c}
    </span>
  )
}

type ThreadKey = { customerId?: number; technicianId?: number }

/** Messages grouped into one thread per person, newest conversation first; a thread opens as a chat. */
function Messages() {
  const snap = useSnap()
  const [show, setShow] = useState<'all' | 'customers' | 'techs' | 'undelivered'>('all')
  const [open, setOpen] = useState<ThreadKey | null>(null)
  const byKey = new Map<string, { key: ThreadKey; id: string; msgs: typeof snap.messages }>()
  for (const m of snap.messages) {
    const id = m.customerId ? `c${m.customerId}` : m.technicianId ? `t${m.technicianId}` : null
    if (!id) continue
    const t = byKey.get(id) ?? { key: m.customerId ? { customerId: m.customerId } : { technicianId: m.technicianId ?? undefined }, id, msgs: [] }
    t.msgs.push(m)
    byKey.set(id, t)
  }
  const all = [...byKey.values()].map((t) => {
    const last = t.msgs.reduce((a, b) => (+new Date(b.createdAt) > +new Date(a.createdAt) ? b : a))
    const undelivered = t.msgs.filter((m) => m.direction === 'out' && m.customerId && !m.delivered).length
    return { ...t, last, undelivered }
  })
  all.sort((a, b) => +new Date(b.last.createdAt) - +new Date(a.last.createdAt))
  const isNew = useArrivals(all.map((t) => t.last.id))
  const rows = all.filter((t) => (show === 'customers' ? !!t.key.customerId : show === 'techs' ? !!t.key.technicianId : show === 'undelivered' ? t.undelivered > 0 : true))
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={show} onValueChange={(v) => v && setShow(v as typeof show)}>
          <ToggleGroupItem value="all" className="px-3 text-xs">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="customers" className="px-3 text-xs">
            Customers
          </ToggleGroupItem>
          <ToggleGroupItem value="techs" className="px-3 text-xs">
            Technicians
          </ToggleGroupItem>
          <ToggleGroupItem value="undelivered" className="px-3 text-xs">
            Not delivered
          </ToggleGroupItem>
        </ToggleGroup>
        <Muted>{rows.length} conversations</Muted>
      </div>
      {rows.length === 0 ? (
        <Empty>{all.length ? 'Nothing matches this filter.' : 'No messages yet.'}</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((t) => {
            const tech = t.key.technicianId ? snap.techs.find((x) => x.id === t.key.technicianId) : undefined
            const name = t.key.customerId ? (snap.customers[t.key.customerId]?.name ?? 'Customer') : (tech?.name ?? 'Technician')
            const out = t.last.direction === 'out'
            const preview = (t.last.channel === 'telegram' ? t.last.body.replace(/<[^>]+>/g, '') : t.last.body).replace(/\s+/g, ' ')
            return (
              <li key={t.id} className={cn(isNew(t.last.id) && 'arrive')}>
                <button
                  type="button"
                  onClick={() => setOpen(t.key)}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 text-left transition-colors outline-none hover:bg-secondary/50 focus-visible:bg-foreground/5"
                >
                  <Avatar name={name} color={tech?.color} badge={tech ? <Wrench className="size-2.5" /> : undefined} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      {tech && <span className="shrink-0 text-[11px] text-muted-foreground">Technician</span>}
                      <ChannelTag c={t.last.channel} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {out && <span className="text-foreground/70">{tech ? 'Sent: ' : 'You: '}</span>}
                      {t.last.subject && !tech ? <span className="text-foreground/80">{t.last.subject} · </span> : null}
                      {preview}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Muted className="whitespace-nowrap" title={dayTime(t.last.createdAt)}>
                      {ago(t.last.createdAt)}
                    </Muted>
                    <div className="flex items-center gap-1">
                      {t.undelivered > 0 && (
                        <span className="rounded-full bg-(--attn-2)/15 px-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">{t.undelivered} not delivered</span>
                      )}
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground/8 px-1.5 text-[11px] text-muted-foreground tabular-nums">
                        {t.msgs.length}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <ThreadDialog who={open} onClose={() => setOpen(null)} />
    </Card>
  )
}

function Calls() {
  const snap = useSnap()
  const [open, setOpen] = useState<(typeof snap.calls)[number] | null>(null)
  const who = (c: (typeof snap.calls)[number]) => (c.customerId ? (snap.customers[c.customerId]?.name ?? c.callerPhone ?? 'Unknown caller') : (c.callerPhone ?? 'Unknown caller'))
  if (!snap.calls.length)
    return (
      <Card>
        <Empty>No calls yet. Try “Call us” on the customer page.</Empty>
      </Card>
    )
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {snap.calls.map((c) => {
          const last = c.transcript.at(-1)
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c)}
                className="grid w-full cursor-pointer text-left outline-none focus-visible:bg-foreground/5 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/50"
              >
                <span className="tile tile-quiet size-9">
                  <Phone className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {c.customerId ? (snap.customers[c.customerId]?.name ?? c.callerPhone ?? 'Unknown caller') : (c.callerPhone ?? 'Unknown caller')}
                    {c.reason && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          c.reason === 'new_case' ? 'bg-primary/12 text-primary' : 'bg-foreground/8 text-muted-foreground',
                        )}
                      >
                        {CALL_REASON[c.reason] ?? c.reason}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {c.summary ? c.summary : last ? `${last.role === 'agent' ? 'Agent' : 'Caller'}: ${last.text}` : 'No transcript'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <Muted className="block whitespace-nowrap" title={dayTime(c.startedAt)}>
                      {ago(c.startedAt)}
                    </Muted>
                    <Muted className="block">
                      {c.transcript.length} {c.transcript.length === 1 ? 'turn' : 'turns'}
                    </Muted>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {open && (
        <TranscriptDialog
          turns={open.transcript}
          title={`Call with ${who(open)}`}
          meta={`${dayTime(open.startedAt)}${open.summary ? ` · ${open.summary}` : ''}`}
          open
          onOpenChange={(o) => !o && setOpen(null)}
        />
      )}
    </Card>
  )
}

function SimulateEmail() {
  const [f, setF] = useState(SAMPLES[0])
  const [last, setLast] = useState<string | null>(null)
  const send = useAction(async () => {
    const r = await simulateEmail({ data: f })
    setLast(r.replyText || r.status)
    return r
  })
  return (
    <div className="px-4 pb-6">
      <div className="mb-3 flex flex-wrap gap-1">
        {SAMPLES.map((s) => (
          <Button key={s.subject} variant={f.subject === s.subject ? 'secondary' : 'ghost'} size="xs" onClick={() => setF(s)}>
            {s.subject}
          </Button>
        ))}
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="sim-name">Name</Label>
            <Input id="sim-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sim-email">Email</Label>
            <Input id="sim-email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sim-subject">Subject</Label>
          <Input id="sim-subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        </div>
        <Textarea rows={5} aria-label="Message" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <Button className="w-full" disabled={send.busy} onClick={() => send.run()}>
          <Send /> {send.busy ? 'Front desk agent working…' : 'Send to front desk'}
        </Button>
        <ErrorText error={send.error} />
        {last && (
          <div className="rounded-lg bg-accent p-3 text-xs whitespace-pre-wrap">
            <div className="mb-1 font-medium text-accent-foreground">Agent reply</div>
            {last}
          </div>
        )}
      </div>
    </div>
  )
}

/** Demo tool, kept out of the way: a test email goes through the same path as the Gmail poller. */
function TestEmailButton() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail /> Send a test email
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Send a test email</SheetTitle>
          <SheetDescription>Goes through the same path as the Gmail poller. The new request appears in the inbox live.</SheetDescription>
        </SheetHeader>
        <SimulateEmail />
      </SheetContent>
    </Sheet>
  )
}

/** Why someone called, as the receptionist judged it from their number and what they said. */
const CALL_REASON: Record<string, string> = { new_case: 'New problem', status_update: 'Status check', resume: 'Called back after drop' }
