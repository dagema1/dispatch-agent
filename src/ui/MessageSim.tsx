import { Mail, MessageSquareText, Plus, Search, Send, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTestThread, getTestThreads, sendAsCustomer } from '#/fns'
import { Empty, ErrorText, Muted } from '#/ui/bits'
import { ago, dayTime } from '#/ui/format'
import { useLive } from '#/ui/live'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type Threads = Awaited<ReturnType<typeof getTestThreads>>
type Person = Threads['others'][number]
type Msg = Awaited<ReturnType<typeof getTestThread>>[number]
type Channel = 'email' | 'sms'

/** Things customers actually send, one tap each. */
const PROMPTS = [
  'When will the technician get here?',
  'Can we move the visit to tomorrow morning?',
  'Our furnace stopped and the house is 55°F. Two kids at home.',
  'Water heater is leaking from the bottom.',
  'Thanks!',
]

const RESULT: Record<string, string> = {
  status_update: 'Answered with the live status of their visit',
  change_request: 'Change request: the office was alerted',
  ack: 'Thanks noted, no reply needed',
  note: 'Passed to the office as a note on their visit',
  completed_request: 'Their answer completed the open request',
  new_case: 'Handled as a new request',
}

/**
 * The customer's side of email and text, for demos without a mail or SMS provider. What the agents
 * send shows up here; what you type goes in as the customer, through the same intake as a real
 * inbound email or text.
 */
export function MessageSim() {
  const { snap } = useLive()
  const [threads, setThreads] = useState<Threads | null>(null)
  const [sel, setSel] = useState<number | 'new' | null>(null)
  const [q, setQ] = useState('')
  const load = useCallback(() => getTestThreads().then(setThreads), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload whenever the live snapshot changes
  useEffect(() => {
    load().catch(() => {})
  }, [load, snap])
  useEffect(() => {
    if (threads && sel == null) setSel(threads.active[0]?.id ?? 'new')
  }, [threads, sel])

  const people = useMemo(() => {
    if (!threads) return []
    const all: Array<Person & { at?: string; count?: number }> = [...threads.active, ...(q ? threads.others : [])]
    const needle = q.trim().toLowerCase()
    return needle ? all.filter((p) => p.name.toLowerCase().includes(needle) || p.email?.toLowerCase().includes(needle) || p.phone?.includes(needle)) : all
  }, [threads, q])
  const person = threads ? ([...threads.active, ...threads.others].find((p) => p.id === sel) ?? null) : null

  if (!threads) return <Skeleton className="h-[560px] w-full rounded-2xl" />
  return (
    <Card className="grid min-h-[560px] grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-(--edge) md:border-r md:border-b-0">
        <div className="space-y-2 p-3">
          <Button variant={sel === 'new' ? 'secondary' : 'outline'} size="sm" className="w-full" onClick={() => setSel('new')}>
            <Plus /> New customer
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find any customer" className="h-8 pl-8 text-sm" aria-label="Find a customer" />
          </div>
        </div>
        <ul className="max-h-48 min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:max-h-none">
          {people.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted-foreground">{q ? 'No match.' : 'No conversations yet.'}</li>}
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSel(p.id)}
                aria-current={sel === p.id ? 'true' : undefined}
                className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors', sel === p.id ? 'bg-foreground/10' : 'hover:bg-foreground/5')}
              >
                <span className="tile tile-quiet size-8 shrink-0 rounded-full text-[11px] font-semibold">
                  {p.name
                    .split(' ')
                    .map((x) => x[0])
                    .join('')
                    .slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{p.at ? `${p.count} messages · ${ago(p.at)}` : (p.email ?? p.phone ?? 'No contact')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col">
        {sel === 'new' ? (
          <NewCustomer
            onSent={async (id) => {
              await load()
              if (id) setSel(id)
            }}
          />
        ) : person ? (
          <Thread key={person.id} person={person} onSent={load} />
        ) : (
          <Empty icon={MessageSquareText}>Pick a customer.</Empty>
        )}
      </section>
    </Card>
  )
}

function Thread({ person, onSent }: { person: Person; onSent: () => void }) {
  const { snap } = useLive()
  const [msgs, setMsgs] = useState<Msg[] | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const load = useCallback(() => getTestThread({ data: { customerId: person.id } }).then(setMsgs), [person.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload whenever the live snapshot changes
  useEffect(() => {
    load().catch(() => {})
  }, [load, snap])
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message arrives
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [msgs?.length])
  const canEmail = !!person.email
  const canText = !!person.phone
  return (
    <>
      <header className="flex items-center gap-3 border-b border-(--edge) px-4 py-3">
        <span className="tile tile-quiet size-9 rounded-full">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{person.name}</div>
          <Muted className="block truncate">{[person.email, person.phone].filter(Boolean).join(' · ') || 'No email or phone on file'}</Muted>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 md:max-h-[460px]">
        {!msgs ? (
          <Skeleton className="h-24 w-2/3 rounded-2xl" />
        ) : msgs.length === 0 ? (
          <Empty icon={Mail}>No emails or texts with {person.name.split(' ')[0]} yet. Write one below as them.</Empty>
        ) : (
          msgs.map((m) => <Bubble key={m.id} m={m} first={person.name.split(' ')[0]} />)
        )}
        <div ref={end} />
      </div>
      <Composer
        name={person.name.split(' ')[0]}
        channels={{ email: canEmail, sms: canText }}
        onSend={async (channel, subject, body) => {
          const r = await sendAsCustomer({ data: { customerId: person.id, channel, subject, body } })
          await load()
          onSent()
          return r
        }}
      />
    </>
  )
}

function Bubble({ m, first }: { m: Msg; first: string }) {
  const mine = m.direction === 'in' // the customer's own message: this is their phone / mailbox
  const sms = m.channel === 'sms'
  const delivery = m.direction === 'out' ? (m.via === 'gmail' ? 'Sent by Gmail' : m.via === 'test' ? 'Test delivery' : 'Not delivered') : `From ${first}`
  return (
    <div className={cn('arrive-pop flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] text-sm leading-relaxed whitespace-pre-line',
          sms ? 'rounded-2xl px-3.5 py-2' : 'w-full rounded-2xl border border-(--edge) px-4 py-3',
          sms && (mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-foreground/8'),
          !sms && (mine ? 'bg-primary/8' : 'bg-(--glass)'),
        )}
      >
        {!sms && (
          <div className="mb-1.5 flex items-center gap-1.5 border-b border-(--edge) pb-1.5 text-xs">
            <Mail className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{m.subject ?? '(no subject)'}</span>
          </div>
        )}
        <Linked text={m.body} />
      </div>
      <span
        className={cn('mt-1 px-1 text-[11px]', m.direction === 'out' && !m.delivered ? 'font-medium text-amber-600 dark:text-(--attn-1)' : 'text-muted-foreground')}
        title={dayTime(m.createdAt)}
      >
        {sms ? 'Text' : 'Email'} · {delivery} · {ago(m.createdAt)}
      </span>
    </div>
  )
}

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)'])/g

/** Message text with its links clickable (tracking, payment, review pages open in a new tab). */
function Linked({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional and static
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  )
}

function Composer({
  name,
  channels,
  onSend,
}: {
  name: string
  channels: { email: boolean; sms: boolean }
  onSend: (c: Channel, subject: string | undefined, body: string) => Promise<{ kind: string }>
}) {
  const [channel, setChannel] = useState<Channel>(channels.sms && !channels.email ? 'sms' : 'email')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const ok = channel === 'email' ? channels.email : channels.sms
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!body.trim() || !ok) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const r = await onSend(channel, channel === 'email' ? subject || undefined : undefined, body.trim())
      setResult(RESULT[r.kind] ?? null)
      setBody('')
      setSubject('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={send} className="space-y-2 border-t border-(--edge) p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={channel} onValueChange={(v) => v && setChannel(v as Channel)} aria-label="Send as">
          <ToggleGroupItem value="email" className="px-3" disabled={!channels.email}>
            <Mail /> Email
          </ToggleGroupItem>
          <ToggleGroupItem value="sms" className="px-3" disabled={!channels.sms}>
            <MessageSquareText /> Text
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBody(p)}
              className="shrink-0 rounded-full bg-foreground/6 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              {p.length > 34 ? `${p.slice(0, 32)}…` : p}
            </button>
          ))}
        </div>
      </div>
      {channel === 'email' && <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" className="h-8 text-sm" />}
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && channel === 'sms') {
              e.preventDefault()
              send()
            }
          }}
          rows={channel === 'sms' ? 1 : 3}
          placeholder={ok ? `Write as ${name}…` : `${name} has no ${channel === 'sms' ? 'phone number' : 'email'} on file`}
          aria-label={`Message as ${name}`}
          className="min-h-9 resize-none"
          disabled={!ok}
        />
        <Button type="submit" disabled={busy || !body.trim() || !ok} className="shrink-0">
          <Send /> {busy ? 'Sending…' : `Send as ${name}`}
        </Button>
      </div>
      {result && <Muted className="block">{result}. The reply, if any, is above.</Muted>}
      <ErrorText error={error} />
    </form>
  )
}

function NewCustomer({ onSent }: { onSent: (id: number | null) => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', subject: '', body: '' })
  const [channel, setChannel] = useState<Channel>('sms')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = f.name.trim().length >= 2 && f.body.trim().length > 0 && (channel === 'sms' ? f.phone.trim().length >= 7 : /\S+@\S+\.\S+/.test(f.email))
  return (
    <form
      className="mx-auto w-full max-w-lg space-y-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const r = await sendAsCustomer({
            data: {
              newCustomer: { name: f.name.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined },
              channel,
              subject: channel === 'email' ? f.subject || undefined : undefined,
              body: f.body.trim(),
            },
          })
          onSent(r.customerId || null)
        } catch (err) {
          setError((err as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">A customer you don’t know yet</h2>
        <Muted className="block">They write in for the first time. Put the address in the message, or the agent will ask for it.</Muted>
      </div>
      <ToggleGroup type="single" variant="outline" size="sm" value={channel} onValueChange={(v) => v && setChannel(v as Channel)} aria-label="Channel">
        <ToggleGroupItem value="sms" className="px-3">
          <MessageSquareText /> Text
        </ToggleGroupItem>
        <ToggleGroupItem value="email" className="px-3">
          <Mail /> Email
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="nc-name" className="mb-1.5">
            Name
          </Label>
          <Input id="nc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dana Whitfield" />
        </div>
        <div>
          <Label htmlFor="nc-phone" className="mb-1.5">
            Phone {channel === 'email' && <span className="font-normal text-muted-foreground">(optional)</span>}
          </Label>
          <Input id="nc-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(303) 555-0187" />
        </div>
        <div>
          <Label htmlFor="nc-email" className="mb-1.5">
            Email {channel === 'sms' && <span className="font-normal text-muted-foreground">(optional)</span>}
          </Label>
          <Input id="nc-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="dana@example.com" />
        </div>
        {channel === 'email' && (
          <div className="sm:col-span-2">
            <Label htmlFor="nc-subj" className="mb-1.5">
              Subject
            </Label>
            <Input id="nc-subj" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="No hot water" />
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="nc-body" className="mb-1.5">
            Message
          </Label>
          <Textarea
            id="nc-body"
            rows={4}
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
            placeholder="Hi, our water heater is leaking from the bottom. 2417 Juniper St, Denver. Can someone come today?"
          />
        </div>
      </div>
      <ErrorText error={error} />
      <Button type="submit" disabled={busy || !valid}>
        <Send /> {busy ? 'Sending…' : 'Send as new customer'}
      </Button>
    </form>
  )
}
