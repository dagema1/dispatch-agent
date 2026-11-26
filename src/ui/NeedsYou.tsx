import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, CircleCheck, Clock, MailX, MessageSquare, Phone, RefreshCw, Send, ShieldQuestion, Siren, X } from 'lucide-react'
import { useState } from 'react'
import { cancelVisit, markMessagesHandled, resolveRequest, retryMessages, sendCustomerMessage } from '#/fns'
import type { Snapshot } from '#/server/api/views'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { CountChip, ErrorText, PanelHead, PriorityTile } from './bits'
import { useConfirm } from './confirm'
import { ago, dayTime } from './format'
import { useAction } from './live'
import { Avatar } from './people'

const OPEN_REQUEST = new Set(['new', 'triaged', 'awaiting_customer', 'escalated'])
const DAY = 86_400_000

/** P1 requests nobody has put on a route yet: they count as open emergencies even before a job exists. */
export const waitingP1 = (snap: Snapshot) => snap.requests.filter((r) => r.priority === 1 && OPEN_REQUEST.has(r.status) && !snap.jobs.some((j) => j.requestId === r.id))

type Kind = 'p1' | 'undelivered' | 'overdue' | 'held'
type Item = {
  key: string
  kind: Kind
  id?: number
  tone: 'red' | 'attn'
  icon: React.ComponentType<{ className?: string }>
  title: string
  detail: string
  action: React.ReactNode
}

/**
 * The one place on the board that answers "is anything on fire?": every item is something only the
 * owner can unblock. The button on the right is the quick fix; the row opens a sheet with the detail
 * and the manual options (message the customer, mark it handled, cancel).
 */
export function NeedsYou({ snap, onReplan, replanBusy }: { snap: Snapshot; onReplan: () => void; replanBusy: boolean }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const items = needsYouItems(snap, onReplan, replanBusy)
  const open = items.find((i) => i.key === openKey) ?? null

  if (!items.length) {
    return (
      <div className="slab flex h-full flex-wrap items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm">
        <CircleCheck className="size-4 text-emerald-500" aria-hidden />
        <span className="font-medium">Nothing needs you right now.</span>
        <span className="text-muted-foreground max-sm:hidden">Emergencies, undelivered replies and held actions show up here.</span>
      </div>
    )
  }

  const red = items.some((i) => i.tone === 'red')
  return (
    <Card aria-label="Needs you" className="h-full gap-0 py-0">
      <PanelHead title="Needs you" badge={<CountChip tone={red ? 'red' : 'attn'}>{items.length}</CountChip>} />
      <ul className="divide-y">
        {items.map((i) => (
          <li key={i.key} className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors hover:bg-foreground/4">
            <span className={cn('tile size-8 shrink-0', i.tone === 'red' ? 'tile-red' : 'tile-attn')}>
              <i.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-56">
              {/* the title button stretches over the row, so the whole row opens the detail */}
              <button
                type="button"
                onClick={() => setOpenKey(i.key)}
                className="text-left text-sm font-medium text-pretty outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
              >
                {i.title}
              </button>
              <p className="text-xs text-muted-foreground">{i.detail}</p>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              {i.action}
              <ChevronRight className="size-4 text-muted-foreground max-sm:hidden" aria-hidden />
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenKey(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {open && <ItemDetail item={open} snap={snap} onReplan={onReplan} replanBusy={replanBusy} />}
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function needsYouItems(snap: Snapshot, onReplan: () => void, replanBusy: boolean): Item[] {
  const now = Date.now()
  const items: Item[] = []
  for (const r of waitingP1(snap)) {
    const c = r.customerId ? snap.customers[r.customerId] : undefined
    items.push({
      key: `p1-${r.id}`,
      kind: 'p1',
      id: r.id,
      tone: 'red',
      icon: Siren,
      title: `Emergency waiting: ${issueOf(r)}`,
      detail: `${c?.name ?? 'Unknown caller'} · came in ${ago(r.createdAt)} · not on a route yet`,
      action: c?.phone ? (
        <Button size="sm" asChild>
          <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
            <Phone /> Call back
          </a>
        </Button>
      ) : null,
    })
  }
  const undelivered = undeliveredOf(snap, now)
  if (undelivered.length)
    items.push({
      key: 'undelivered',
      kind: 'undelivered',
      tone: 'attn',
      icon: MailX,
      title: `${undelivered.length} customer ${undelivered.length === 1 ? 'reply was' : 'replies were'} not delivered`,
      detail: 'No email or text channel is connected, so customers have not heard back.',
      action: (
        <Button size="sm" variant="ghost" asChild>
          <Link to="/app/settings" search={{ tab: 'integrations' }}>
            Connect
          </Link>
        </Button>
      ),
    })
  const overdue = overdueOf(snap, now)
  if (overdue.length)
    items.push({
      key: 'overdue',
      kind: 'overdue',
      tone: 'attn',
      icon: Clock,
      title: `${overdue.length} unassigned ${overdue.length === 1 ? 'visit is' : 'visits are'} past the customer's window`,
      detail: 'Re-plan to find new slots, then confirm new times with the customers.',
      action: (
        <Button size="sm" variant="ghost" onClick={onReplan} disabled={replanBusy}>
          <RefreshCw className={cn(replanBusy && 'animate-spin')} /> Re-plan
        </Button>
      ),
    })
  const held = snap.approvals.filter((a) => a.status === 'pending').length
  if (held)
    items.push({
      key: 'held',
      kind: 'held',
      tone: 'attn',
      icon: ShieldQuestion,
      title: `${held} ${held === 1 ? 'action is' : 'actions are'} waiting for your OK`,
      detail: 'Held by your permission rules.',
      action: (
        <Button size="sm" variant="ghost" asChild>
          <Link to="/app/approvals">Review</Link>
        </Button>
      ),
    })
  return items
}

type Req = Snapshot['requests'][number]
const issueOf = (r: Req) => (r.extracted as { issue?: string } | null)?.issue ?? r.summary ?? 'P1 request'
const undeliveredOf = (snap: Snapshot, now: number) => snap.messages.filter((m) => m.direction === 'out' && m.customerId && !m.delivered && now - +new Date(m.createdAt) < 2 * DAY)
const overdueOf = (snap: Snapshot, now: number) => snap.jobs.filter((j) => j.status === 'unassigned' && +new Date(j.windowEnd) < now)

/* ---------- the sheet ---------- */

function ItemDetail({ item, snap, onReplan, replanBusy }: { item: Item; snap: Snapshot; onReplan: () => void; replanBusy: boolean }) {
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="flex items-center gap-2.5 pr-8">
          <span className={cn('tile size-8 shrink-0', item.tone === 'red' ? 'tile-red' : 'tile-attn')}>
            <item.icon className="size-4" />
          </span>
          {item.kind === 'p1' ? 'Emergency waiting' : item.title}
        </SheetTitle>
        <SheetDescription>{item.detail}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 p-4">
        {item.kind === 'p1' && item.id != null && <Emergency snap={snap} requestId={item.id} />}
        {item.kind === 'undelivered' && <Undelivered snap={snap} />}
        {item.kind === 'overdue' && <Overdue snap={snap} onReplan={onReplan} replanBusy={replanBusy} />}
        {item.kind === 'held' && <Held snap={snap} />}
      </div>
    </>
  )
}

function Emergency({ snap, requestId }: { snap: Snapshot; requestId: number }) {
  const confirm = useConfirm()
  const r = snap.requests.find((x) => x.id === requestId)
  const resolve = useAction((id: number) => resolveRequest({ data: { requestId: id } }))
  if (!r) return null
  const c = r.customerId ? snap.customers[r.customerId] : undefined
  const ask = async () => {
    const ok = await confirm({
      title: 'Mark this emergency handled?',
      description: 'It leaves the queue and nobody is sent. Use this when you have called back, sent someone yourself, or it was not an emergency.',
      confirm: 'Mark handled',
      icon: Check,
    })
    if (ok) resolve.run(r.id)
  }
  return (
    <>
      <Who name={c?.name} email={c?.email} phone={c?.phone} />
      <section className="space-y-1.5">
        <h3 className={LABEL}>{r.channel === 'voice' ? 'What they said' : 'Their message'}</h3>
        <blockquote className="well rounded-xl px-3.5 py-3 text-sm text-pretty whitespace-pre-line">{r.rawText}</blockquote>
        {r.safetyFlag && <p className="text-xs text-red-600 dark:text-red-400">Safety flag: {r.safetyFlag.replace(/_/g, ' ')}</p>}
      </section>
      <div className="flex flex-wrap gap-2">
        {c?.phone && (
          <Button asChild>
            <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
              <Phone /> Call {c.name.split(' ')[0]}
            </a>
          </Button>
        )}
        <Button variant="outline" onClick={ask} disabled={resolve.busy}>
          <Check /> Mark handled
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/app/inbox">Open inbox</Link>
        </Button>
      </div>
      <ErrorText error={resolve.error} />
      {r.customerId && (
        <Composer
          customerId={r.customerId}
          requestId={r.id}
          hasEmail={!!c?.email}
          subject="We are on it"
          body={`We got your message about ${issueOf(r).toLowerCase()} and a technician is being arranged now. If anything gets worse, call us right away.`}
        />
      )}
    </>
  )
}

function Undelivered({ snap }: { snap: Snapshot }) {
  const list = undeliveredOf(snap, Date.now())
  const [note, setNote] = useState<string | null>(null)
  const retry = useAction(async (ids: number[]) => {
    const r = await retryMessages({ data: { ids } })
    setNote(r.delivered ? `${r.delivered} of ${r.total} sent.` : 'Still no channel to send through. Connect Gmail, or turn on the test inbox in Settings.')
  })
  const handled = useAction((ids: number[]) => markMessagesHandled({ data: { ids } }))
  const all = list.map((m) => m.id)
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => retry.run(all)} disabled={retry.busy || !all.length}>
          <RefreshCw className={cn(retry.busy && 'animate-spin')} /> Try all again
        </Button>
        <Button variant="outline" onClick={() => handled.run(all)} disabled={handled.busy || !all.length}>
          <Check /> I told them myself
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/app/settings" search={{ tab: 'integrations' }}>
            Connect a channel
          </Link>
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ErrorText error={retry.error ?? handled.error} />
      <ul className="divide-y rounded-xl border">
        {list.map((m) => {
          const c = m.customerId ? snap.customers[m.customerId] : undefined
          return (
            <li key={m.id} className="space-y-1 px-3.5 py-3 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-medium">{c?.name ?? 'Customer'}</span>
                <span className="text-xs text-muted-foreground">
                  {m.channel === 'sms' ? 'text' : m.channel} · {ago(m.createdAt)}
                </span>
              </div>
              {m.subject && <div className="truncate text-xs font-medium">{m.subject}</div>}
              <p className="line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
              <div className="flex gap-1 pt-1">
                <Button size="xs" variant="outline" onClick={() => retry.run([m.id])} disabled={retry.busy}>
                  Try again
                </Button>
                <Button size="xs" variant="ghost" onClick={() => handled.run([m.id])} disabled={handled.busy}>
                  Told them myself
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Overdue({ snap, onReplan, replanBusy }: { snap: Snapshot; onReplan: () => void; replanBusy: boolean }) {
  const confirm = useConfirm()
  const list = overdueOf(snap, Date.now())
  const [writing, setWriting] = useState<number | null>(null)
  const cancel = useAction((jobId: number) => cancelVisit({ data: { jobId } }))
  const askCancel = async (jobId: number, title: string) => {
    const ok = await confirm({
      title: 'Cancel this visit?',
      description: `“${title}” comes off the schedule. The customer is not told; message them first if they are waiting.`,
      confirm: 'Cancel visit',
      tone: 'danger',
      icon: X,
    })
    if (ok) cancel.run(jobId)
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onReplan} disabled={replanBusy}>
          <RefreshCw className={cn(replanBusy && 'animate-spin')} /> Re-plan all
        </Button>
      </div>
      <ErrorText error={cancel.error} />
      <ul className="divide-y rounded-xl border">
        {list.map((j) => {
          const c = snap.customers[j.customerId]
          return (
            <li key={j.id} className="space-y-2 px-3.5 py-3 text-sm">
              <div className="flex items-center gap-2">
                <PriorityTile p={j.priority} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{j.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c?.name ?? 'Customer'} · window ended {dayTime(j.windowEnd)}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="xs" variant="outline" onClick={() => setWriting(writing === j.id ? null : j.id)} aria-expanded={writing === j.id}>
                  <MessageSquare /> Message
                </Button>
                <Button size="xs" variant="ghost" onClick={() => askCancel(j.id, j.title)} disabled={cancel.busy}>
                  Cancel visit
                </Button>
              </div>
              {writing === j.id && (
                <Composer
                  customerId={j.customerId}
                  jobId={j.id}
                  hasEmail={!!c?.email}
                  subject="About your visit"
                  body={`We are sorry, we could not make your ${j.title.toLowerCase()} visit in the window we gave you. We are finding a new time now and will confirm it shortly.`}
                  onSent={() => setWriting(null)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Held({ snap }: { snap: Snapshot }) {
  const list = snap.approvals.filter((a) => a.status === 'pending')
  return (
    <>
      <ul className="divide-y rounded-xl border">
        {list.map((a) => (
          <li key={a.id} className="px-3.5 py-3 text-sm">
            <div className="font-medium">{a.summary}</div>
            {a.reason && <div className="text-xs text-muted-foreground">{a.reason}</div>}
          </li>
        ))}
      </ul>
      <Button asChild>
        <Link to="/app/approvals">Review and decide</Link>
      </Button>
    </>
  )
}

const LABEL = 'text-[11px] font-medium tracking-wider text-muted-foreground uppercase'

function Who({ name, email, phone, address }: { name?: string; email?: string | null; phone?: string | null; address?: string | null }) {
  return (
    <section className="well flex items-start gap-3 rounded-xl px-3.5 py-3">
      <Avatar name={name ?? '?'} />
      <div className="min-w-0 space-y-0.5 text-sm">
        <div className="truncate font-medium">{name ?? 'Unknown caller'}</div>
        {phone && <div className="text-xs text-muted-foreground tabular-nums">{phone}</div>}
        {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
        {address && <div className="text-xs text-muted-foreground">{address}</div>}
      </div>
    </section>
  )
}

/** Write to the customer from here. Goes out like an agent message: persona sign-off, email or text, test inbox in the demo. */
function Composer({
  customerId,
  requestId,
  jobId,
  hasEmail,
  subject: subject0,
  body: body0,
  onSent,
}: {
  customerId: number
  requestId?: number
  jobId?: number
  hasEmail: boolean
  subject: string
  body: string
  onSent?: () => void
}) {
  const [subject, setSubject] = useState(subject0)
  const [body, setBody] = useState(body0)
  const [done, setDone] = useState<string | null>(null)
  const send = useAction(async () => {
    const r = await sendCustomerMessage({ data: { customerId, requestId, jobId, subject, body } })
    setDone(r.delivered ? (r.via === 'test' ? 'Sent to the test inbox.' : 'Sent.') : 'Saved, but not delivered: no email or text channel is connected.')
    onSent?.()
  })
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        setDone(null)
        send.run()
      }}
    >
      <h3 className={LABEL}>Message the customer</h3>
      {hasEmail && <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
      <Textarea aria-label="Message" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={send.busy || body.trim().length < 2}>
          <Send /> {send.busy ? 'Sending…' : hasEmail ? 'Send email' : 'Send text'}
        </Button>
        {done && <span className="text-xs text-muted-foreground">{done}</span>}
        <ErrorText error={send.error} />
      </div>
    </form>
  )
}
