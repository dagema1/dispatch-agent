import { createFileRoute } from '@tanstack/react-router'
import { BellRing, Clock, FileCheck, Flame, RefreshCw, Wallet } from 'lucide-react'
import { markPaidTest } from '#/fns'
import { ErrorText, PageTitle, Stat, Status } from '#/ui/bits'
import { ago, money } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { Avatar } from '#/ui/people'
import { Cell2, RichTable } from '#/ui/RichTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/money')({ component: Money })

function Money() {
  const snap = useSnap()
  const check = useAction((invoiceId: number) => markPaidTest({ data: { invoiceId } }))
  const inv = snap.invoices
  const sum = (s: string) => inv.filter((i) => i.status === s).reduce((a, i) => a + i.totalCents, 0)
  const accepted = snap.quotes.filter((q) => q.status === 'accepted')
  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle title="Quotes & invoices" sub="Quotes use only the price book. Payment links are Stripe test mode." />
      <ErrorText error={check.error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Collected"
          icon={Wallet}
          value={money(sum('paid'))}
          hint="paid through Stripe"
          ratio={sum('paid') + sum('sent') ? sum('paid') / (sum('paid') + sum('sent')) : 0}
        />
        <Stat
          label="Outstanding"
          icon={Clock}
          value={money(sum('sent'))}
          tone={sum('sent') ? 'warn' : undefined}
          hint={sum('sent') ? 'reminders go out automatically' : 'nothing owed'}
        />
        <Stat
          label="Quotes accepted"
          icon={FileCheck}
          value={`${accepted.length} / ${snap.quotes.length}`}
          hint="good · better · best"
          ratio={snap.quotes.length ? accepted.length / snap.quotes.length : 0}
        />
        <Stat label="Replacement leads" icon={Flame} value={snap.quotes.filter((q) => q.replacementLead).length} hint="units at or past end of life" />
      </div>
      <div className="space-y-4">
        <RichTable
          title="Invoices"
          rows={inv}
          rowKey={(i) => i.id}
          initialSort={{ key: 'created', dir: 'desc' }}
          empty="No invoices yet. Close a job from the board or with /done in Telegram."
          columns={[
            {
              key: 'invoice',
              label: 'Invoice',
              sort: (i) => i.id,
              cell: (i) => <Cell2 top={`#${i.id}`} sub={i.lines.map((l) => l.name).join(' · ')} />,
            },
            {
              key: 'customer',
              label: 'Customer',
              sort: (i) => snap.customers[i.customerId]?.name ?? '',
              cell: (i) => (
                <div className="flex items-center gap-2.5">
                  <Avatar name={snap.customers[i.customerId]?.name ?? '?'} size="sm" />
                  <Cell2 top={snap.customers[i.customerId]?.name ?? '—'} sub={snap.customers[i.customerId]?.email} />
                </div>
              ),
            },
            { key: 'status', label: 'Status', sort: (i) => i.status, cell: (i) => <Status s={i.status} /> },
            {
              key: 'created',
              label: 'Created',
              className: 'hidden lg:table-cell',
              sort: (i) => +new Date(i.createdAt),
              cell: (i) => (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-3.5" /> {ago(i.createdAt)}
                </span>
              ),
            },
            {
              key: 'reminders',
              label: 'Reminders',
              className: 'hidden xl:table-cell',
              sort: (i) => i.remindersSent,
              cell: (i) => (
                <span className="inline-flex items-center gap-1.5 tabular-nums text-muted-foreground">
                  <BellRing className="size-3.5" /> {i.remindersSent}
                </span>
              ),
            },
            {
              key: 'pay',
              label: 'Payment',
              cell: (i) => (
                <div className="flex items-center gap-3">
                  {i.payUrl && (
                    <a href={i.payUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                      Pay link
                    </a>
                  )}
                  {i.status === 'sent' && i.stripeSessionId && (
                    <Button variant="ghost" size="xs" onClick={() => check.run(i.id)} disabled={check.busy}>
                      <RefreshCw /> Check
                    </Button>
                  )}
                </div>
              ),
            },
            {
              key: 'amount',
              label: 'Amount',
              align: 'right',
              sort: (i) => i.totalCents,
              cell: (i) => <span className="font-semibold tabular-nums">{money(i.totalCents, 2)}</span>,
            },
          ]}
        />
        <RichTable
          title="Photo quotes"
          rows={snap.quotes}
          rowKey={(q) => q.id}
          empty="No quotes yet. Upload photos when booking on the customer page."
          columns={[
            {
              key: 'quote',
              label: 'Quote',
              sort: (q) => q.id,
              cell: (q) => {
                const dx = q.diagnosis as { brand?: string; equipmentKind?: string; ageYears?: number; errorCode?: string }
                return (
                  <Cell2
                    top={
                      <a href={q.url} target="_blank" rel="noreferrer" className="hover:underline">
                        Quote #{q.id}
                      </a>
                    }
                    sub={[dx.brand, dx.equipmentKind?.replace('_', ' '), dx.ageYears != null ? `${dx.ageYears} yrs` : null, dx.errorCode ? `code ${dx.errorCode}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                )
              },
            },
            {
              key: 'customer',
              label: 'Customer',
              sort: (q) => (q.customerId ? (snap.customers[q.customerId]?.name ?? '') : ''),
              cell: (q) => (
                <div className="flex items-center gap-2.5">
                  <Avatar name={(q.customerId && snap.customers[q.customerId]?.name) || '?'} size="sm" />
                  <Cell2 top={q.customerId ? snap.customers[q.customerId]?.name : '—'} sub={ago(q.createdAt)} />
                </div>
              ),
            },
            {
              key: 'options',
              label: 'Options',
              cell: (q) => (
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((o) => (
                    <Badge
                      key={o.tier}
                      variant="outline"
                      className={cn(
                        'font-normal capitalize tabular-nums',
                        q.chosenTier === o.tier ? 'border-primary/40 bg-accent text-accent-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {o.tier} {money(o.totalCents)}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              sort: (q) => q.status,
              cell: (q) => (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Status s={q.status} />
                  {q.replacementLead && (
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                      <Flame className="size-3" /> lead
                    </Badge>
                  )}
                </div>
              ),
            },
            {
              key: 'value',
              label: 'Value',
              align: 'right',
              sort: (q) => quoteValue(q),
              cell: (q) => <span className="font-semibold tabular-nums">{money(quoteValue(q))}</span>,
            },
          ]}
        />
      </div>
    </div>
  )
}

type Quote = ReturnType<typeof useSnap>['quotes'][number]
/** The chosen tier once accepted, otherwise the middle ("better") option as the likely value. */
const quoteValue = (q: Quote) => (q.options.find((o) => o.tier === q.chosenTier) ?? q.options[1] ?? q.options[0])?.totalCents ?? 0
