import { createFileRoute } from '@tanstack/react-router'
import { BellRing, Clock, ExternalLink, FileCheck, Flame, Mail, Phone, RefreshCw, Wallet } from 'lucide-react'
import { useState } from 'react'
import { markPaidTest } from '#/fns'
import { ErrorText, PageTitle, Stat, Status } from '#/ui/bits'
import { ago, dayTime, money } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { Avatar } from '#/ui/people'
import { Cell2, RichTable } from '#/ui/RichTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/money')({ component: Money })

function Money() {
  const snap = useSnap()
  const check = useAction((invoiceId: number) => markPaidTest({ data: { invoiceId } }))
  const inv = snap.invoices
  const sum = (s: string) => inv.filter((i) => i.status === s).reduce((a, i) => a + i.totalCents, 0)
  const accepted = snap.quotes.filter((q) => q.status === 'accepted')
  const [openId, setOpenId] = useState<number | null>(null)
  const open = inv.find((i) => i.id === openId) ?? null
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
          onRowClick={(i) => setOpenId(i.id)}
          rowLabel={(i) => `Invoice #${i.id}, ${snap.customers[i.customerId]?.name ?? 'customer'}, ${money(i.totalCents, 2)}`}
          columns={[
            { key: 'invoice', label: 'Invoice', sort: (i) => i.id, cell: (i) => <span className="font-medium tabular-nums">#{i.id}</span> },
            {
              key: 'customer',
              label: 'Customer',
              sort: (i) => snap.customers[i.customerId]?.name ?? '',
              cell: (i) => (
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={snap.customers[i.customerId]?.name ?? '?'} size="sm" />
                  <span className="truncate font-medium">{snap.customers[i.customerId]?.name ?? '—'}</span>
                </div>
              ),
            },
            { key: 'status', label: 'Status', sort: (i) => i.status, cell: (i) => <Status s={i.status} /> },
            {
              key: 'created',
              label: 'Created',
              className: 'hidden md:table-cell',
              sort: (i) => +new Date(i.createdAt),
              cell: (i) => <span className="text-muted-foreground">{ago(i.createdAt)}</span>,
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
        <InvoiceDialog invoice={open} onClose={() => setOpenId(null)} onCheck={(id) => check.run(id)} checking={check.busy} />
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

type Invoice = ReturnType<typeof useSnap>['invoices'][number]

/** Everything about one invoice: who, what was billed, where it stands, and the payment actions. */
function InvoiceDialog({ invoice, onClose, onCheck, checking }: { invoice: Invoice | null; onClose: () => void; onCheck: (id: number) => void; checking: boolean }) {
  const snap = useSnap()
  // keep the last invoice while the dialog animates closed
  const [shown, setShown] = useState<Invoice | null>(invoice)
  if (invoice && invoice !== shown) setShown(invoice)
  const i = invoice ?? shown
  const c = i ? snap.customers[i.customerId] : undefined
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {i && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                Invoice #{i.id} <Status s={i.status} />
              </DialogTitle>
              <DialogDescription>Created {dayTime(i.createdAt)}</DialogDescription>
            </DialogHeader>
            <section className="well flex items-center gap-3 rounded-xl px-3.5 py-3">
              <Avatar name={c?.name ?? '?'} />
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium">{c?.name ?? 'Unknown customer'}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {c?.email && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Mail className="size-3 shrink-0" /> <span className="truncate">{c.email}</span>
                    </span>
                  )}
                  {c?.phone && (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Phone className="size-3" /> {c.phone}
                    </span>
                  )}
                </div>
              </div>
            </section>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] tracking-wider text-muted-foreground uppercase">
                  <th className="pb-2 text-left font-medium">Item</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {i.lines.map((l, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: invoice lines are fixed once issued
                  <tr key={n}>
                    <td className="py-2 pr-3">
                      <div>{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.code}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.qty}</td>
                    <td className="py-2 text-right tabular-nums">{money(l.cents * l.qty, 2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan={2} className="pt-2.5 font-medium">
                    Total
                  </td>
                  <td className="pt-2.5 text-right text-base font-semibold tabular-nums">{money(i.totalCents, 2)}</td>
                </tr>
              </tfoot>
            </table>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Sent</dt>
              <dd className="text-right">{i.sentAt ? dayTime(i.sentAt) : 'Not yet'}</dd>
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right">{i.paidAt ? dayTime(i.paidAt) : 'Not yet'}</dd>
              <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                <BellRing className="size-3.5" /> Reminders
              </dt>
              <dd className="text-right tabular-nums">{i.remindersSent}</dd>
            </dl>
            {(i.payUrl || (i.status === 'sent' && i.stripeSessionId)) && (
              <DialogFooter>
                {i.status === 'sent' && i.stripeSessionId && (
                  <Button variant="outline" onClick={() => onCheck(i.id)} disabled={checking}>
                    <RefreshCw /> Check payment
                  </Button>
                )}
                {i.payUrl && (
                  <Button asChild>
                    <a href={i.payUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open pay link
                    </a>
                  </Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
