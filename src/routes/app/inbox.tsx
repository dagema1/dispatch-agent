import { createFileRoute } from '@tanstack/react-router'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Globe, Inbox, Mail, MessageSquare, Phone, Send, ShieldAlert, Thermometer, Timer } from 'lucide-react'
import { useState } from 'react'
import { simulateEmail } from '#/fns'
import { Empty, ErrorText, Muted, PageTitle, Priority, Section, Status } from '#/ui/bits'
import { ago, dayTime } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <div>
      <PageTitle title="Inbox & calls" sub="Every channel lands in one pipeline: safety check → triage → booking → reply. First responses are measured." />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Tabs defaultValue="requests" className="min-w-0">
          <TabsList className="h-9">
            <TabsTrigger value="requests" className="px-3">
              <Inbox /> Requests <Count n={snap.requests.length} />
            </TabsTrigger>
            <TabsTrigger value="messages" className="px-3">
              <MessageSquare /> Messages <Count n={snap.messages.length} />
            </TabsTrigger>
            <TabsTrigger value="calls" className="px-3">
              <Phone /> Calls <Count n={snap.calls.length} />
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
        <div className="xl:sticky xl:top-4">
          <SimulateEmail />
        </div>
      </div>
    </div>
  )
}

const Count = ({ n }: { n: number }) => <span className="rounded-full bg-muted-foreground/10 px-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>

/** Leading tile: the channel it came in on, tinted by how urgent triage judged it. */
const TILE: Record<number, string> = { 1: 'tile-red', 2: 'tile-attn', 3: 'tile-action', 4: 'tile-quiet' }
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
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
        <Muted>{rows.length} shown</Muted>
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
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] gap-3 px-4 py-3 transition-colors hover:bg-secondary/60">
                    <ChannelTile c={r.channel} p={r.priority} />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-semibold">{name ?? 'Unknown sender'}</span>
                        <ChannelTag c={r.channel} />
                      </div>
                      <div className="truncate text-sm">{ex.issue ?? r.summary ?? 'Request'}</div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground group-open:hidden">{r.rawText}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Muted className="whitespace-nowrap">{ago(r.createdAt)}</Muted>
                      <div className="flex flex-wrap justify-end gap-1">
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
                  <div className="space-y-2 pr-4 pb-4 pl-[4.25rem]">
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

const ChannelTile = ({ c, p }: { c: string; p: number | null }) => {
  const I = channelIcon(c)
  return (
    <span className={cn('tile size-9', TILE[p ?? 4])} aria-hidden>
      <I className="size-4" />
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
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
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
        <Muted>{rows.length} shown</Muted>
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
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/60">
                    <span className={cn('mt-0.5 grid size-7 place-items-center rounded-full', out ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>
                      {out ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-medium">
                          {out ? 'To' : 'From'} {to}
                        </span>
                        <ChannelTag c={m.channel} />
                        {out && !m.delivered && <span className="text-[11px] text-amber-700 dark:text-amber-400">not delivered · channel not connected</span>}
                      </div>
                      {m.subject && <div className="truncate text-sm">{m.subject}</div>}
                      <p className="line-clamp-2 text-xs text-muted-foreground group-open:line-clamp-none group-open:whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <Muted className="whitespace-nowrap">{dayTime(m.createdAt)}</Muted>
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
                <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/60">
                  <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Phone className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{c.customerId ? snap.customers[c.customerId]?.name : `Caller #${c.id}`}</div>
                    <p className="truncate text-xs text-muted-foreground">{last ? `${last.role === 'agent' ? 'Agent' : 'Caller'}: ${last.text}` : 'No transcript'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <Muted className="block whitespace-nowrap">{dayTime(c.startedAt)}</Muted>
                      <Muted className="block">{c.transcript.length} turns</Muted>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </div>
                </summary>
                <div className="space-y-1.5 px-4 pb-4">
                  {c.transcript.map((t, i) => (
                    <div key={i} className={cn('flex', t.role !== 'agent' && 'justify-end')}>
                      <div className={cn('max-w-[80%] rounded-2xl px-3 py-1.5 text-sm', t.role === 'agent' ? 'bg-muted' : 'bg-primary text-primary-foreground')}>{t.text}</div>
                    </div>
                  ))}
                </div>
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
    <Section title="Send a test email" right={<Muted>same path as the Gmail poller</Muted>}>
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
    </Section>
  )
}
