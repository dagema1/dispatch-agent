import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, CalendarRange, Camera, CircleDollarSign, Phone, Route as RouteIcon, ShieldCheck, Sparkles, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({ component: Home })

const FEATURES = [
  { icon: Phone, title: 'Answers every contact', text: 'Voice receptionist in the browser, email and web chat. Safety advice first, then a booked slot, 24/7.' },
  { icon: Camera, title: 'Diagnoses from photos', text: 'Reads the unit label and error lights, prices good / better / best options from the price book.' },
  { icon: RouteIcon, title: 'Plans the whole fleet', text: 'Skills, time windows, priority and drive times. Re-plans on every emergency, delay or sick call.' },
  { icon: CircleDollarSign, title: 'Turns jobs into cash', text: 'Tech voice note → job report → invoice → Stripe payment link → reminders until paid.' },
  { icon: ShieldCheck, title: 'Stays in its lane', text: 'Policy engine: what it may do alone, what needs your approval, what it never does. Every step traced.' },
  { icon: CalendarRange, title: 'Works ahead', text: 'Morning route briefs, SLA watchdog, cold-snap and heat-wave campaigns, payment chasing.' },
]

/** Sample day for the hero preview: a static picture of the board, not live data. */
const PREVIEW = [
  {
    tech: 'Jake',
    jobs: [
      { at: 8, len: 1.5, t: 'Furnace no heat' },
      { at: 11, len: 1, t: 'Water heater' },
      { at: 14, len: 2, t: 'AC tune-up' },
    ],
  },
  {
    tech: 'Maria',
    jobs: [
      { at: 9, len: 2, t: 'Drain clog · P1' },
      { at: 13, len: 1.5, t: 'Thermostat' },
    ],
  },
  {
    tech: 'Tom',
    jobs: [
      { at: 8.5, len: 1, t: 'Leak check' },
      { at: 10.5, len: 2.5, t: 'Boiler service' },
      { at: 15, len: 1, t: 'Quote visit' },
    ],
  },
]

function Home() {
  return (
    <div className="dark relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* Curtain light: vertical blue beams falling from the top edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px]">
        <div className="absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,oklch(0.5_0.25_270/0.55),transparent_70%)]" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_38px,oklch(0.6_0.22_272/0.07)_38px_40px)] [mask-image:radial-gradient(55%_65%_at_50%_0%,black,transparent_75%)]" />
      </div>

      <header className="relative mx-auto flex max-w-6xl items-center gap-6 px-4 py-5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="tile tile-solid size-7 rounded-full">
            <Wrench className="size-3.5" />
          </span>
          Northline
        </span>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <Link to="/book" className="hover:text-foreground">
            Book a visit
          </Link>
        </nav>
        <Button asChild size="sm" className="ml-auto h-8 px-4 md:ml-0">
          <Link to="/app">Open dashboard</Link>
        </Button>
      </header>

      <main className="relative mx-auto max-w-6xl px-4">
        <section className="flex flex-col items-center pt-14 pb-16 text-center md:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="size-3.5 text-primary" /> AI front office for HVAC &amp; plumbing
          </span>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-7xl">
            From first call to paid invoice, <span className="font-display text-[1.1em] text-primary">handled</span>.
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-muted-foreground md:text-lg">
            Built for residential shops where the dispatcher is the busiest seat in the building and every missed call is a lost job.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button size="lg" className="h-11 px-6 text-base" asChild>
              <Link to="/app">
                Owner dashboard <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" className="h-11 border-transparent bg-[oklch(0.92_0_0)] bg-none px-6 text-base text-[oklch(0.15_0_0)] shadow-none hover:bg-white" asChild>
              <Link to="/book">I'm a customer</Link>
            </Button>
          </div>
        </section>

        <BoardPreview />

        <section id="features" className="scroll-mt-8 py-20 md:py-28">
          <h2 className="text-center text-3xl font-semibold tracking-tight md:text-4xl">
            One agent, the <span className="font-display text-[1.1em] text-primary">whole</span> front office.
          </h2>
          <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="bg-card p-6">
                <f.icon className="size-5 text-primary" />
                <div className="mt-4 font-medium">{f.title}</div>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-center text-xs text-muted-foreground">Demo data is fictional. Payments run in Stripe test mode.</p>
        </section>
      </main>
    </div>
  )
}

/** A framed, static picture of the dispatch board, so the hero shows the product rather than describing it. */
function BoardPreview() {
  const start = 8
  const span = 9
  return (
    <div aria-hidden className="relative mx-auto max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 h-40 bg-[radial-gradient(50%_100%_at_50%_100%,oklch(0.55_0.25_270/0.35),transparent)] blur-2xl" />
      <div className="relative rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-2 shadow-2xl">
        <div className="overflow-hidden rounded-2xl border border-white/8 bg-card">
          <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3 text-xs">
            <span className="font-medium">Dispatch board</span>
            <span className="text-muted-foreground">· Today</span>
            <span className="ml-auto rounded-full bg-foreground/8 px-2.5 py-0.5 text-muted-foreground">8 jobs · 3 techs</span>
          </div>
          <div className="space-y-2 p-4">
            <div className="ml-16 flex justify-between text-[10px] text-muted-foreground">
              {[8, 11, 14, 17].map((h) => (
                <span key={h}>{h}:00</span>
              ))}
            </div>
            {PREVIEW.map((row) => (
              <div key={row.tech} className="flex items-center gap-3">
                <span className="w-13 shrink-0 text-xs text-muted-foreground">{row.tech}</span>
                <div className="relative h-9 flex-1 rounded-lg bg-white/[0.03]">
                  {row.jobs.map((j) => (
                    <span
                      key={j.t}
                      className="absolute inset-y-1 truncate rounded-md border border-primary/30 bg-primary/15 px-2 text-[11px] leading-7 text-foreground/90"
                      style={{ left: `${((j.at - start) / span) * 100}%`, width: `${(j.len / span) * 100}%` }}
                    >
                      {j.t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
