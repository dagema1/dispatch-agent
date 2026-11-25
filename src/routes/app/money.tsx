import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { markPaidTest } from '#/fns'
import { Empty, ErrorText, Muted, PageTitle, Section, Stat, Status } from '#/ui/bits'
import { ago, money } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
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
    <div>
      <PageTitle title="Quotes & invoices" sub="Photo quotes are priced only from the price book. Invoices go out with a Stripe test-mode link and get chased automatically." />
      <ErrorText error={check.error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected" value={money(sum('paid'))} tone="good" />
        <Stat label="Outstanding" value={money(sum('sent'))} tone={sum('sent') ? 'warn' : undefined} />
        <Stat label="Quotes accepted" value={`${accepted.length} / ${snap.quotes.length}`} />
        <Stat label="Replacement leads" value={snap.quotes.filter((q) => q.replacementLead).length} hint="units at or past end of life" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Invoices">
          {inv.length === 0 ? (
            <Empty>No invoices yet. Close a job from the board or with /done in Telegram.</Empty>
          ) : (
            <ul className="divide-y">
              {inv.map((i) => (
                <li key={i.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">#{i.id}</span>
                    <span>{snap.customers[i.customerId]?.name}</span>
                    <Status s={i.status} />
                    <span className="ml-auto font-semibold tabular-nums">{money(i.totalCents, 2)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{i.lines.map((l) => l.code).join(' · ')}</span>
                    <span>{ago(i.createdAt)}</span>
                    {i.remindersSent > 0 && <span>{i.remindersSent} reminder(s)</span>}
                    {i.payUrl && (
                      <Button variant="link" size="xs" className="h-auto px-0 text-[11px]" asChild>
                        <a href={i.payUrl} target="_blank" rel="noreferrer">
                          pay link
                        </a>
                      </Button>
                    )}
                    {i.status === 'sent' && i.stripeSessionId && (
                      <Button variant="link" size="xs" className="h-auto px-0 text-[11px]" onClick={() => check.run(i.id)} disabled={check.busy}>
                        <RefreshCw /> check payment
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Photo quotes">
          {snap.quotes.length === 0 ? (
            <Empty>No quotes yet. Upload photos when booking on the customer page.</Empty>
          ) : (
            <ul className="divide-y">
              {snap.quotes.map((q) => {
                const dx = q.diagnosis as {
                  brand?: string
                  equipmentKind?: string
                  ageYears?: number
                  errorCode?: string
                }
                return (
                  <li key={q.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Button variant="link" className="h-auto px-0 font-medium" asChild>
                        <a href={q.url} target="_blank" rel="noreferrer">
                          Quote #{q.id}
                        </a>
                      </Button>
                      <span>{q.customerId ? snap.customers[q.customerId]?.name : ''}</span>
                      <Status s={q.status} />
                      {q.replacementLead && <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">replacement lead</Badge>}
                    </div>
                    <Muted className="mt-0.5 block text-[11px]">
                      {[dx.brand, dx.equipmentKind?.replace('_', ' '), dx.ageYears != null ? `${dx.ageYears} yrs` : null, dx.errorCode ? `code ${dx.errorCode}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Muted>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {q.options.map((o) => (
                        <Badge key={o.tier} variant="outline" className={cn('capitalize', q.chosenTier === o.tier && 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950')}>
                          {o.tier}: {money(o.totalCents)}
                        </Badge>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
