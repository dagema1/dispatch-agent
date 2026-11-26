import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Clock } from 'lucide-react'
import { z } from 'zod'
import { getPaid } from '#/fns'
import { CustomerShell, NotFound } from '#/ui/CustomerShell'
import { money } from '#/ui/format'
import { Card, CardContent } from '@/components/ui/card'

export const Route = createFileRoute('/c/paid')({
  validateSearch: z.object({
    // a missing or mangled id shows the not-found card instead of a 500
    invoice: z.coerce.number().int().positive().optional().catch(undefined),
    cancelled: z.coerce.number().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ invoice: search.invoice }),
  loader: ({ deps }) => (deps.invoice ? getPaid({ data: { invoice: deps.invoice } }) : null),
  component: Paid,
  head: () => ({ meta: [{ title: 'Payment' }] }),
})

function Paid() {
  const d = Route.useLoaderData()
  const { cancelled } = Route.useSearch()
  if (!d) return <NotFound />
  const paid = d.invoice.status === 'paid'
  return (
    <CustomerShell company={d.company}>
      <Card>
        <CardContent className="py-2 text-center">
          {paid ? <CheckCircle2 className="mx-auto size-10 text-emerald-600" /> : <Clock className="mx-auto size-10 text-amber-500" />}
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance">
            {paid ? 'Payment received, thank you!' : cancelled ? 'Payment not completed' : 'Confirming your payment…'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            Invoice #{d.invoice.id} · {money(d.invoice.totalCents, 2)}
          </p>
        </CardContent>
      </Card>
    </CustomerShell>
  )
}
