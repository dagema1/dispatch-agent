import { createFileRoute } from '@tanstack/react-router'
import { ChevronRight, Mail, MessageSquare, Phone, Send } from 'lucide-react'
import { useState } from 'react'
import { simulateEmail } from '#/fns'
import { Empty, ErrorText, Muted, PageTitle, Priority, Section, Status } from '#/ui/bits'
import { ago, dayTime } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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

function InboxPage() {
  const snap = useSnap()
  return (
    <div>
      <PageTitle title="Inbox & calls" sub="Every channel lands in one pipeline: safety check → triage → booking → reply. First responses are measured." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Tabs defaultValue="requests" className="min-w-0">
          <TabsList>
            <TabsTrigger value="requests">Requests ({snap.requests.length})</TabsTrigger>
            <TabsTrigger value="messages">Messages ({snap.messages.length})</TabsTrigger>
            <TabsTrigger value="calls">Calls ({snap.calls.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">
            <Requests />
          </TabsContent>
          <TabsContent value="messages">
            <Messages />
          </TabsContent>
          <TabsContent value="calls">
            <Calls />
          </TabsContent>
        </Tabs>
        <SimulateEmail />
      </div>
    </div>
  )
}

function Requests() {
  const snap = useSnap()
  if (!snap.requests.length) return <Empty>No requests yet. Book from the customer page or send a test email.</Empty>
  return (
    <div className="space-y-2">
      {snap.requests.map((r) => {
        const ex = (r.extracted ?? {}) as {
          reasons?: string[]
          issue?: string
          weatherF?: number
        }
        const resp = r.firstResponseAt ? Math.round((+new Date(r.firstResponseAt) - +new Date(r.createdAt)) / 1000) : null
        return (
          <Card key={r.id} size="sm">
            <CardContent className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <ChannelIcon c={r.channel} />
                <span className="text-sm font-medium">{ex.issue ?? r.summary ?? 'Request'}</span>
                <Priority p={r.priority} short />
                {r.safetyFlag && <Badge variant="destructive">⚠ {r.safetyFlag.replace('_', ' ')}</Badge>}
                <Status s={r.status} />
                <Muted className="ml-auto">
                  {r.customerId ? snap.customers[r.customerId]?.name : 'unknown'} · {ago(r.createdAt)}
                </Muted>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{r.rawText}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {ex.reasons && (
                  <span>
                    Why P{r.priority}: {ex.reasons.join(' · ')}
                  </span>
                )}
                {ex.weatherF != null && <span>Outside: {ex.weatherF}°F</span>}
                {resp != null && (
                  <span className={cn(resp < 60 && 'text-emerald-600 dark:text-emerald-400')}>First response in {resp < 90 ? `${resp}s` : `${Math.round(resp / 60)} min`}</span>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

const ChannelIcon = ({ c }: { c: string }) => {
  const I = c === 'voice' ? Phone : c === 'email' ? Mail : MessageSquare
  return (
    <span className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground" title={c}>
      <I className="size-3.5" />
    </span>
  )
}

function Messages() {
  const snap = useSnap()
  if (!snap.messages.length) return <Empty>No messages yet.</Empty>
  return (
    <div className="space-y-2">
      {snap.messages.map((m) => (
        <Card key={m.id} size="sm" className={cn('border-l-4', m.direction === 'in' ? 'border-l-muted-foreground/40' : 'border-l-primary')}>
          <CardContent className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">
                {m.direction === 'in' ? 'From' : 'To'} {m.customerId ? snap.customers[m.customerId]?.name : m.technicianId ? `tech #${m.technicianId}` : '—'}
              </span>
              <Badge variant="secondary">{m.channel}</Badge>
              {m.direction === 'out' && (
                <Badge
                  variant="outline"
                  className={cn(m.delivered ? 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'text-muted-foreground')}
                >
                  {m.delivered ? 'delivered' : 'outbox (channel not connected)'}
                </Badge>
              )}
              <Muted className="ml-auto">{dayTime(m.createdAt)}</Muted>
            </div>
            {m.subject && <div className="text-sm font-medium">{m.subject}</div>}
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{m.body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Calls() {
  const snap = useSnap()
  if (!snap.calls.length) return <Empty>No calls yet. Try “Call us” on the customer page.</Empty>
  return (
    <div className="space-y-2">
      {snap.calls.map((c) => (
        <Card key={c.id} size="sm">
          <CardContent>
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                <Phone className="size-3.5" /> Call #{c.id}
                {c.customerId && <span className="font-medium">{snap.customers[c.customerId]?.name}</span>}
                <Muted>{c.transcript.length} turns</Muted>
                <Muted className="ml-auto">{dayTime(c.startedAt)}</Muted>
              </summary>
              <div className="mt-2 space-y-1 pl-6">
                {c.transcript.map((t, i) => (
                  <div key={i} className={cn('text-sm', t.role === 'agent' ? 'text-primary' : 'text-foreground')}>
                    <span className="font-medium">{t.role === 'agent' ? 'Agent' : 'Caller'}:</span> {t.text}
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>
      ))}
    </div>
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
