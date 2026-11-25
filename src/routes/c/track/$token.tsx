import { ClientOnly, createFileRoute, useRouter } from '@tanstack/react-router'
import { CheckCircle2, Clock, Truck, Wrench } from 'lucide-react'
import { Suspense, lazy, useEffect } from 'react'
import { getTrack } from '#/fns'
import { dayTime, time } from '#/ui/format'
import { CustomerShell, NotFound } from '#/ui/CustomerShell'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const FleetMap = lazy(() => import('#/ui/FleetMap'))

export const Route = createFileRoute('/c/track/$token')({
  loader: ({ params }) => getTrack({ data: { token: params.token } }),
  component: Track,
  head: () => ({ meta: [{ title: 'Track your technician' }] }),
})

const STEPS = [
  { s: 'scheduled', label: 'Booked', icon: Clock },
  { s: 'en_route', label: 'On the way', icon: Truck },
  { s: 'on_site', label: 'On site', icon: Wrench },
  { s: 'done', label: 'Done', icon: CheckCircle2 },
]

function Track() {
  const d = Route.useLoaderData()
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.invalidate(), 15_000)
    return () => clearInterval(t)
  }, [router])
  if (!d) return <NotFound />
  const idx = Math.max(
    0,
    STEPS.findIndex((x) => x.s === d.job.status),
  )
  const live = d.tech?.live
  return (
    <CustomerShell company={d.company}>
      <h1 className="text-xl font-bold">Hi {d.customer.firstName}, here's your visit</h1>
      <p className="mt-1 text-sm text-muted-foreground">{d.job.title}</p>
      <Card className="mt-4">
        <CardContent>
          <div className="flex justify-between">
            {STEPS.map((x, i) => (
              <div key={x.s} className={cn('flex flex-1 flex-col items-center text-center text-xs', i <= idx ? 'font-medium text-primary' : 'text-muted-foreground')}>
                <div className={cn('grid size-9 place-items-center rounded-full', i <= idx ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                  <x.icon className="size-4" />
                </div>
                <span className="mt-1">{x.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 text-center">
            {d.job.status === 'done' ? (
              <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">All done. Thanks for choosing us!</div>
            ) : d.job.status === 'en_route' ? (
              <>
                <div className="text-sm text-muted-foreground">{d.tech?.firstName} is on the way · estimated arrival</div>
                <div className="text-3xl font-bold tabular-nums">{time(d.job.etaAt ?? d.job.scheduledStart)}</div>
              </>
            ) : d.job.scheduledStart ? (
              <>
                <div className="text-sm text-muted-foreground">{d.tech ? `${d.tech.firstName} arrives` : 'Arrival'} between</div>
                <div className="text-2xl font-bold tabular-nums">
                  {dayTime(d.job.scheduledStart)} – {time(new Date(new Date(d.job.scheduledStart).getTime() + 3_600_000))}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">We're finding the first available technician. We'll update you shortly.</div>
            )}
          </div>
        </CardContent>
      </Card>
      {d.customer.lat != null && (
        <Card className="mt-4 gap-0 overflow-hidden p-2">
          <ClientOnly fallback={<Skeleton className="h-[260px] rounded-xl" />}>
            <Suspense fallback={<Skeleton className="h-[260px] rounded-xl" />}>
              <FleetMap
                height={260}
                techs={
                  live && live.lat != null
                    ? [
                        {
                          id: 1,
                          name: d.tech!.firstName,
                          color: d.tech!.color,
                          lat: live.lat,
                          lng: live.lng!,
                          live: true,
                        },
                      ]
                    : []
                }
                jobs={[
                  {
                    id: 1,
                    lat: d.customer.lat,
                    lng: d.customer.lng!,
                    color: 'var(--primary)',
                    priority: 3,
                    label: 'Your home',
                  },
                ]}
                routes={
                  live && live.lat != null
                    ? [
                        {
                          color: d.tech!.color,
                          points: [
                            [live.lat, live.lng!],
                            [d.customer.lat, d.customer.lng!],
                          ],
                        },
                      ]
                    : []
                }
              />
            </Suspense>
          </ClientOnly>
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            {live ? 'Live location shared by your technician · updates automatically' : 'Live location appears when your technician is on the way'}
          </div>
        </Card>
      )}
    </CustomerShell>
  )
}
