import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CheckCircle2, Star } from 'lucide-react'
import { useState } from 'react'
import { chooseQuote, getQuote } from '#/fns'
import { CustomerShell, NotFound } from '#/ui/CustomerShell'
import { money } from '#/ui/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/c/quote/$token')({
  loader: ({ params }) => getQuote({ data: { token: params.token } }),
  component: Quote,
  head: () => ({ meta: [{ title: 'Your options' }] }),
})

function Quote() {
  const d = Route.useLoaderData()
  const { token } = Route.useParams()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  if (!d) return <NotFound />
  const dx = d.quote.diagnosis as {
    brand?: string | null
    model?: string | null
    equipmentKind?: string
    ageYears?: number | null
    errorCode?: string | null
    observations?: string[]
    likelyFaults?: Array<{ fault: string; probability: number }>
  }
  const accepted = d.quote.status === 'accepted'
  const choose = async (tier: 'good' | 'better' | 'best') => {
    setBusy(tier)
    await chooseQuote({ data: { token, tier } })
    await router.invalidate()
    setBusy(null)
  }
  return (
    <CustomerShell company={d.company}>
      <h1 className="text-xl font-bold">{d.customer.firstName}, here are your options</h1>
      <Card size="sm" className="mt-4">
        <CardContent className="text-sm">
          <div className="font-medium">What we see in your photos</div>
          <div className="mt-1 text-muted-foreground">
            {[dx.brand, dx.model, dx.equipmentKind?.replace('_', ' ')].filter(Boolean).join(' ')}
            {dx.ageYears != null && <> · about {dx.ageYears} years old</>}
            {dx.errorCode && <> · error code {dx.errorCode}</>}
          </div>
          {dx.likelyFaults?.[0] && <div className="mt-1 text-muted-foreground">Most likely: {dx.likelyFaults[0].fault}</div>}
          {d.quote.replacementLead && (
            <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              This unit is at or past its expected lifespan. Repairs may not last; replacement is worth considering.
            </div>
          )}
          <div className="mt-2 text-[11px] text-muted-foreground">Final diagnosis is confirmed on site. Prices include parts and labour.</div>
        </CardContent>
      </Card>
      <div className="mt-4 space-y-3">
        {d.quote.options.map((o) => {
          const chosen = d.quote.chosenTier === o.tier
          return (
            <Card key={o.tier} size="sm" className={cn(chosen ? 'ring-2 ring-emerald-500' : o.tier === 'better' && 'ring-2 ring-primary/30')}>
              <CardContent>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {o.tier}
                      {o.tier === 'better' && (
                        <Badge variant="secondary" className="bg-accent text-accent-foreground normal-case tracking-normal">
                          <Star /> most popular
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 font-semibold">{o.title}</div>
                  </div>
                  <div className="text-right text-xl font-bold tabular-nums">{money(o.totalCents)}</div>
                </div>
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  {o.lines.map((l) => (
                    <li key={l.code} className="flex justify-between">
                      <span>{l.name}</span>
                      <span className="tabular-nums">{money(l.cents)}</span>
                    </li>
                  ))}
                </ul>
                {chosen ? (
                  <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" /> Selected. Your technician will bring what's needed.
                  </div>
                ) : (
                  !accepted && (
                    <Button variant={o.tier === 'better' ? 'default' : 'outline'} size="lg" className="mt-3 h-11 w-full text-base" disabled={!!busy} onClick={() => choose(o.tier)}>
                      {busy === o.tier ? 'Saving…' : `Choose ${o.tier}`}
                    </Button>
                  )
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </CustomerShell>
  )
}
