import { Link } from '@tanstack/react-router'
import { CircleCheck, Clock, MailX, Phone, RefreshCw, ShieldQuestion, Siren } from 'lucide-react'
import type { Snapshot } from '#/server/api/views'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ago } from './format'

const OPEN_REQUEST = new Set(['new', 'triaged', 'awaiting_customer', 'escalated'])
const DAY = 86_400_000

/** P1 requests nobody has put on a route yet: they count as open emergencies even before a job exists. */
export const waitingP1 = (snap: Snapshot) => snap.requests.filter((r) => r.priority === 1 && OPEN_REQUEST.has(r.status) && !snap.jobs.some((j) => j.requestId === r.id))

type Item = { key: string; tone: 'red' | 'attn'; icon: React.ComponentType<{ className?: string }>; title: string; detail: string; action: React.ReactNode }

/** The one place on the board that answers "is anything on fire?": every item is something only the owner can unblock, with the action next to it. */
export function NeedsYou({ snap, onReplan, replanBusy }: { snap: Snapshot; onReplan: () => void; replanBusy: boolean }) {
  const now = Date.now()
  const items: Item[] = []

  for (const r of waitingP1(snap)) {
    const c = r.customerId ? snap.customers[r.customerId] : undefined
    items.push({
      key: `p1-${r.id}`,
      tone: 'red',
      icon: Siren,
      title: `Emergency waiting: ${(r.extracted as { issue?: string } | null)?.issue ?? r.summary ?? 'P1 request'}`,
      detail: `${c?.name ?? 'Unknown caller'} · came in ${ago(r.createdAt)} · not on a route yet`,
      action: c?.phone ? (
        <Button size="sm" asChild>
          <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
            <Phone /> Call back
          </a>
        </Button>
      ) : (
        <Button size="sm" variant="outline" asChild>
          <Link to="/app/inbox">Open</Link>
        </Button>
      ),
    })
  }

  const undelivered = snap.messages.filter((m) => m.direction === 'out' && m.customerId && !m.delivered && now - +new Date(m.createdAt) < 2 * DAY)
  if (undelivered.length) {
    items.push({
      key: 'undelivered',
      tone: 'attn',
      icon: MailX,
      title: `${undelivered.length} customer ${undelivered.length === 1 ? 'reply was' : 'replies were'} not delivered`,
      detail: 'No email or text channel is connected, so customers have not heard back.',
      action: (
        <Button size="sm" variant="outline" asChild>
          <Link to="/app/settings" search={{ tab: 'integrations' }}>
            Connect
          </Link>
        </Button>
      ),
    })
  }

  const overdue = snap.jobs.filter((j) => j.status === 'unassigned' && +new Date(j.windowEnd) < now)
  if (overdue.length) {
    items.push({
      key: 'overdue',
      tone: 'attn',
      icon: Clock,
      title: `${overdue.length} unassigned ${overdue.length === 1 ? 'visit is' : 'visits are'} past the customer's window`,
      detail: 'Re-plan to find new slots, then confirm new times with the customers.',
      action: (
        <Button size="sm" variant="outline" onClick={onReplan} disabled={replanBusy}>
          <RefreshCw className={cn(replanBusy && 'animate-spin')} /> Re-plan
        </Button>
      ),
    })
  }

  const held = snap.approvals.filter((a) => a.status === 'pending').length
  if (held) {
    items.push({
      key: 'held',
      tone: 'attn',
      icon: ShieldQuestion,
      title: `${held} ${held === 1 ? 'action is' : 'actions are'} waiting for your OK`,
      detail: 'Held by your permission rules.',
      action: (
        <Button size="sm" variant="outline" asChild>
          <Link to="/app/approvals">Review</Link>
        </Button>
      ),
    })
  }

  if (!items.length) {
    return (
      <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-(--edge) bg-(--glass) px-4 py-3 text-sm backdrop-blur-xl">
        <CircleCheck className="size-4 text-emerald-500" aria-hidden />
        <span className="font-medium">Nothing needs you right now.</span>
        <span className="text-muted-foreground max-sm:hidden">Emergencies, undelivered replies and held actions show up here.</span>
      </div>
    )
  }

  const red = items.some((i) => i.tone === 'red')
  return (
    <section aria-label="Needs you" className={cn('slab mb-4 overflow-hidden rounded-2xl border', red ? 'border-red-500/40' : 'border-(--attn-2)/40')}>
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-1 text-sm font-semibold">
        <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] tabular-nums', red ? 'bg-red-500 text-white' : 'bg-(--attn-2) text-black')}>
          {items.length}
        </span>
        Needs you
      </h2>
      <ul className="divide-y divide-(--edge)">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <span className={cn('tile size-8 shrink-0', i.tone === 'red' ? 'tile-red' : 'tile-attn')}>
              <i.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-medium text-pretty">{i.title}</p>
              <p className="text-xs text-muted-foreground">{i.detail}</p>
            </div>
            <div className="shrink-0">{i.action}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}
