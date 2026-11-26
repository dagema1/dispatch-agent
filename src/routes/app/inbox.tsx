import { createFileRoute } from '@tanstack/react-router'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Globe, Inbox, Mail, MessageSquare, Phone, Send, ShieldAlert, Thermometer, Timer } from 'lucide-react'
import { useState } from 'react'
import { simulateEmail } from '#/fns'
import { Empty, ErrorText, Muted, PageTitle, Priority, Status } from '#/ui/bits'
import { ago, dayTime } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { Avatar } from '#/ui/people'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/inbox')({ component: InboxPage })

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

function InboxPage() {
  const snap = useSnap()
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title="Inbox & calls" right={<TestEmailButton />} />
      <Tabs defaultValue="requests" className="min-w-0">
        <TabsList className="h-10 w-full sm:w-fit">
          <TabsTrigger value="requests" className="flex-1 px-2 sm:flex-none sm:px-3">
            <Inbox className="max-sm:hidden" /> Requests <Count n={snap.requests.length} />
          </TabsTrigger>
          <TabsTrigger value="messages" className="flex-1 px-2 sm:flex-none sm:px-3">
            <MessageSquare className="max-sm:hidden" /> Messages <Count n={snap.messages.length} />
          </TabsTrigger>
          <TabsTrigger value="calls" className="flex-1 px-2 sm:flex-none sm:px-3">
            <Phone className="max-sm:hidden" /> Calls <Count n={snap.calls.length} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-2">
          <Requests />
        </TabsContent>
        <TabsContent value="messages" className="mt-2">
          <Messages />
        </TabsContent>
        <TabsContent value="calls" className="mt-2">
          <Calls />
        </TabsContent>
      </Tabs>
    </div>
  )
}

const Count = ({ n }: { n: number }) => (
  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground/8 px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground in-data-[state=active]:bg-primary in-data-[state=active]:text-primary-foreground">
    {n}
  </span>
)

const channelIcon = (c: string) => (c === 'voice' ? Phone : c === 'email' ? Mail : c === 'web' ? Globe : MessageSquare)
const OPEN = ['new', 'triaged', 'awaiting_customer']

const fmtResp = (s: number) => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)

function Requests() {
  const snap = useSnap()
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
            const resp = r.firstResponseAt ? Math.round((+new Date(r.firstResponseAt) - +new Date(r.createdAt)) / 1000) : null
            const name = r.customerId ? snap.customers[r.customerId]?.name : null
            return (
              <li key={r.id} className={cn(isNew(r.id) && 'arrive')}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-4 transition-colors hover:bg-secondary/50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5">
                    <SenderAvatar name={name ?? '?'} c={r.channel} p={r.priority} />
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{name ?? 'Unknown sender'}</span>
                        <Muted className="shrink-0 whitespace-nowrap sm:hidden">{ago(r.createdAt)}</Muted>
                      </div>
                      <div className="truncate text-sm">{ex.issue ?? r.summary ?? 'Request'}</div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground group-open:hidden">{r.rawText}</p>
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
                  </summary>
                  <div className="space-y-2 px-4 pb-5 sm:pr-5 sm:pl-[4.75rem]">
                    <p className="well rounded-xl p-3 text-sm whitespace-pre-wrap">{r.rawText}</p>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {resp != null && (
                        <Badge variant="outline" className={cn(resp < 60 && 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400')}>
                          <Timer /> replied in {fmtResp(resp)}
                        </Badge>
                      )}
                      {ex.weatherF != null && (
                        <Badge variant="outline">
                          <Thermometer /> {ex.weatherF}°F outside
                        </Badge>
                      )}
                    </div>
                    {ex.reasons?.length ? (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Why P{r.priority}:</span> {ex.reasons.join(' · ')}
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      )}
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

function Messages() {
  const snap = useSnap()
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const isNew = useArrivals(snap.messages.map((m) => m.id))
  const rows = snap.messages.filter((m) => dir === 'all' || m.direction === dir)
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={dir} onValueChange={(v) => v && setDir(v as typeof dir)}>
          <ToggleGroupItem value="all" className="px-3 text-xs">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="in" className="px-3 text-xs">
            Received
          </ToggleGroupItem>
          <ToggleGroupItem value="out" className="px-3 text-xs">
            Sent by agents
          </ToggleGroupItem>
        </ToggleGroup>
        {dir !== 'all' && <Muted>{rows.length} shown</Muted>}
      </div>
      {rows.length === 0 ? (
        <Empty>No messages yet.</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((m) => {
            const to = m.customerId
              ? snap.customers[m.customerId]?.name
              : m.technicianId
                ? (snap.techs.find((t) => t.id === m.technicianId)?.name ?? `Tech #${m.technicianId}`)
                : 'Office'
            const out = m.direction === 'out'
            return (
              <li key={m.id} className={cn(isNew(m.id) && 'arrive')}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] gap-4 px-5 py-4 transition-colors hover:bg-secondary/50">
                    <Avatar
                      name={m.customerId || m.technicianId ? to : 'Office'}
                      color={m.technicianId ? snap.techs.find((t) => t.id === m.technicianId)?.color : undefined}
                      badge={out ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-semibold">
                            {out ? 'To' : 'From'} {to}
                          </span>
                          <ChannelTag c={m.channel} />
                        </div>
                        <Muted className="shrink-0 whitespace-nowrap">{dayTime(m.createdAt)}</Muted>
                      </div>
                      {m.subject && <div className="text-sm font-medium">{m.subject}</div>}
                      <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground group-open:line-clamp-none group-open:whitespace-pre-wrap group-open:text-foreground/85">
                        {m.body}
                      </p>
                      {out && !m.delivered && <p className="text-xs text-muted-foreground">Not delivered: channel not connected</p>}
                    </div>
                  </summary>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function Calls() {
  const snap = useSnap()
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
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/50">
                  <span className="tile tile-quiet size-9">
                    <Phone className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{c.customerId ? snap.customers[c.customerId]?.name : `Caller #${c.id}`}</div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{last ? `${last.role === 'agent' ? 'Agent' : 'Caller'}: ${last.text}` : 'No transcript'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <Muted className="block whitespace-nowrap">{dayTime(c.startedAt)}</Muted>
                      <Muted className="block">{c.transcript.length} turns</Muted>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </div>
                </summary>
                <ol className="well mx-5 mb-5 space-y-3 rounded-xl p-4">
                  {c.transcript.map((t, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript; a turn never moves
                    <li key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm leading-relaxed">
                      <span className={cn('pt-px text-xs font-medium', t.role === 'agent' ? 'text-primary' : 'text-muted-foreground')}>
                        {t.role === 'agent' ? 'Agent' : 'Caller'}
                      </span>
                      <span className="text-foreground/90">{t.text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          )
        })}
      </ul>
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
