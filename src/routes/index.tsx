import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, CalendarRange, Camera, CircleDollarSign, Phone, Route as RouteIcon, ShieldCheck, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const Route = createFileRoute('/')({ component: Home })

const FEATURES = [
  {
    icon: Phone,
    title: 'Answers every contact',
    text: 'Voice receptionist in the browser, email and web chat. Safety advice first, then a booked slot, 24/7.',
  },
  {
    icon: Camera,
    title: 'Diagnoses from photos',
    text: 'Reads the unit label and error lights, prices good / better / best options from the price book.',
  },
  {
    icon: RouteIcon,
    title: 'Plans the whole fleet',
    text: 'Skills, time windows, priority and drive times. Re-plans on every emergency, delay or sick call.',
  },
  {
    icon: CircleDollarSign,
    title: 'Turns jobs into cash',
    text: 'Tech voice note → job report → invoice → Stripe payment link → reminders until paid.',
  },
  {
    icon: ShieldCheck,
    title: 'Stays in its lane',
    text: 'Policy engine: what it may do alone, what needs your approval, what it never does. Every step traced.',
  },
  {
    icon: CalendarRange,
    title: 'Works ahead',
    text: 'Morning route briefs, SLA watchdog, cold-snap and heat-wave campaigns, payment chasing.',
  },
]

function Home() {
  return (
    <div className="min-h-dvh bg-linear-to-b from-accent to-background">
      <div className="mx-auto max-w-5xl px-4 py-12 md:py-20">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Wrench className="size-3.5" />
          </span>
          Northline Heating &amp; Plumbing · demo company
        </div>
        <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-balance md:text-5xl">An AI front office, from the first call to the paid invoice.</h1>
        <p className="mt-4 max-w-2xl text-pretty text-muted-foreground md:text-lg">
          Built for residential HVAC and plumbing shops, where the dispatcher / CSR is the busiest seat in the building and every missed call is a lost job.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" className="h-11 px-5 text-base" asChild>
            <Link to="/app">
              Owner dashboard <ArrowRight />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="h-11 px-5 text-base" asChild>
            <Link to="/book">I'm a customer: call or book</Link>
          </Button>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardContent>
                <f.icon className="size-5 text-primary" />
                <div className="mt-3 font-semibold">{f.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-10 text-xs text-muted-foreground">Demo data is fictional. Payments run in Stripe test mode.</p>
      </div>
    </div>
  )
}
