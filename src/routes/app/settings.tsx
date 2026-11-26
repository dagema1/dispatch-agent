import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Ban,
  Bot,
  CalendarClock,
  Check,
  CircleDashed,
  Clock,
  CloudSun,
  CreditCard,
  Database,
  Hand,
  KeyRound,
  Mail,
  MapPinned,
  MessageSquare,
  Play,
  Plug,
  RotateCcw,
  Route as RouteIcon,
  Send,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sun,
  Wallet,
  Zap,
} from 'lucide-react'
import { resetDemo, runCronNow, setPolicy, setWeather } from '#/fns'
import { ErrorText, Muted, PageTitle } from '#/ui/bits'
import { useConfirm } from '#/ui/confirm'
import { useAction, useSnap } from '#/ui/live'
import { PersonaSettings } from '#/ui/PersonaSettings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const TABS = ['persona', 'permissions', 'integrations', 'automation', 'demo'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TABS.includes(s.tab as Tab) ? { tab: s.tab as Tab } : {}),
})

type Level = 'auto' | 'approve' | 'never'
type Icon = React.ComponentType<{ className?: string }>

/** Permissions grouped the way an owner thinks about them: talking to customers, the schedule, money. */
const POLICY_GROUPS: Array<{ title: string; icon: Icon; items: Array<[key: string, label: string, hint: string]> }> = [
  {
    title: 'Talking to customers',
    icon: MessageSquare,
    items: [
      ['send_customer_message', 'Reply to customers', 'Confirmations, questions and schedule updates'],
      ['send_quote', 'Send quotes', 'Good, better, best options from the price book'],
      ['send_campaign', 'Send marketing campaigns', 'Seasonal or weather offers to many customers at once'],
    ],
  },
  {
    title: 'The schedule',
    icon: CalendarClock,
    items: [
      ['book_job', 'Book jobs', 'Put a new request on a technician’s route'],
      ['replan_day', 'Re-plan the day', 'Reorder routes when something changes'],
      ['move_booked_job', 'Move a booked visit to another day', 'The customer is told the new time'],
      ['after_hours_dispatch', 'Dispatch a tech after hours', 'Call someone out outside opening hours'],
    ],
  },
  {
    title: 'Money',
    icon: Wallet,
    items: [
      ['send_invoice', 'Send invoices', 'With a Stripe payment link when a job closes'],
      ['send_payment_reminder', 'Send payment reminders', 'Gentle nudges on open invoices'],
      ['apply_discount', 'Apply a discount', 'Any price below the price book'],
      ['refund', 'Issue refunds', 'Money back to a customer'],
      ['price_outside_book', 'Charge a price outside the price book', 'Custom line items'],
    ],
  },
]
const POLICY_LABEL = Object.fromEntries(POLICY_GROUPS.flatMap((g) => g.items.map(([k, l]) => [k, l])))

const LEVEL: Record<Level, { label: string; hint: string; dot: string; icon: Icon }> = {
  auto: { label: 'On its own', hint: 'Runs without asking', dot: 'bg-primary', icon: Zap },
  approve: { label: 'Ask me first', hint: 'Waits in Approvals', dot: 'bg-(--attn-2)', icon: Hand },
  never: { label: 'Never', hint: 'Blocked and handed to you', dot: 'bg-muted-foreground/50', icon: Ban },
}

const NAV: Record<Tab, { label: string; icon: Icon }> = {
  persona: { label: 'Agent persona', icon: Bot },
  permissions: { label: 'Permissions', icon: ShieldCheck },
  integrations: { label: 'Integrations', icon: Plug },
  automation: { label: 'Automation', icon: Clock },
  demo: { label: 'Demo data', icon: Database },
}

function SettingsPage() {
  const snap = useSnap()
  const tab = Route.useSearch().tab ?? 'persona'
  const i = snap.integrations
  const connected = [i.gemini, i.telegram, i.ors, i.stripe, !!i.googleAccount, true].filter(Boolean).length
  const asking = Object.values(snap.settings.policies).filter((v) => v === 'approve').length
  const meta: Partial<Record<Tab, string>> = {
    persona: (snap.settings.persona as { agentName: string }).agentName,
    permissions: `${asking} ask first`,
    integrations: `${connected} of 6`,
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title="Settings" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <nav aria-label="Settings sections">
          <ul className="segmented flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full p-[3px]">
            {TABS.map((t) => {
              const n = NAV[t]
              const on = t === tab
              return (
                <li key={t} className="shrink-0">
                  <Link
                    to="/app/settings"
                    search={{ tab: t }}
                    replace
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      on ? 'bg-foreground/11 font-medium text-foreground shadow-[inset_0_1px_0_var(--edge)]' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                    )}
                  >
                    <n.icon className={cn('size-4 shrink-0', on && 'text-primary')} />
                    <span>{n.label}</span>
                    {meta[t] && <span className="rounded-full bg-foreground/8 px-1.5 text-[11px] text-muted-foreground tabular-nums max-xl:hidden">{meta[t]}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div key={tab} className="route-in min-w-0">
          {tab === 'persona' && <PersonaSettings />}
          {tab === 'permissions' && <Permissions />}
          {tab === 'integrations' && <Integrations />}
          {tab === 'automation' && <Automation />}
          {tab === 'demo' && <Demo />}
        </div>
      </div>
    </div>
  )
}

/* ---------- Permissions ---------- */

function Permissions() {
  const snap = useSnap()
  const confirm = useConfirm()
  const pol = useAction((key: string, value: Level) => setPolicy({ data: { key, value } }))
  const policies = snap.settings.policies as Record<string, Level>
  const count = (l: Level) => Object.values(policies).filter((v) => v === l).length

  const change = async (k: string, to: Level) => {
    if (to === policies[k]) return
    if (to === 'auto') {
      const ok = await confirm({
        title: 'Let the agents do this on their own?',
        description: `“${POLICY_LABEL[k] ?? k}” will run without asking you, unless the model is unsure.`,
        confirm: 'Allow',
        tone: 'attn',
        icon: ShieldCheck,
      })
      if (!ok) return
    }
    pol.run(k, to)
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">What the agents may do</h2>
            <Muted className="block">
              Anything set to run on its own still waits for you when model confidence is below {Math.round(snap.settings.thresholds.minConfidence * 100)}%.
            </Muted>
          </div>
          <ul className="flex flex-wrap gap-2">
            {(Object.keys(LEVEL) as Level[]).map((l) => (
              <li key={l} className="well inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs">
                <span className={cn('size-2 rounded-full', LEVEL[l].dot)} aria-hidden />
                {LEVEL[l].label}
                <span className="font-semibold tabular-nums">{count(l)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <ErrorText error={pol.error} />
      {POLICY_GROUPS.map((g) => (
        <Card key={g.title} className="gap-0 py-0">
          <div className="flex items-center gap-2.5 border-b px-5 py-3.5">
            <g.icon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{g.title}</h2>
          </div>
          <ul className="divide-y">
            {g.items.map(([k, label, hint]) => (
              <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{hint}</div>
                </div>
                <LevelPicker label={label} value={policies[k] ?? 'approve'} disabled={pol.busy} onChange={(v) => change(k, v)} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

/** Segmented control: the active level shows its colour dot, the others stay quiet. */
function LevelPicker({ label, value, onChange, disabled }: { label: string; value: Level; onChange: (v: Level) => void; disabled?: boolean }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={value} disabled={disabled} aria-label={label} onValueChange={(v) => v && onChange(v as Level)}>
      {(Object.keys(LEVEL) as Level[]).map((l) => (
        <ToggleGroupItem key={l} value={l} title={LEVEL[l].hint} className="gap-1.5 px-2.5 text-xs data-[state=on]:font-medium">
          <span className={cn('size-1.5 shrink-0 rounded-full bg-muted-foreground/30', value === l && LEVEL[l].dot)} aria-hidden />
          {LEVEL[l].label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/* ---------- Integrations ---------- */

function Integrations() {
  const snap = useSnap()
  const i = snap.integrations
  const items: Array<{ name: string; icon: Icon; ok: boolean; what: string; how: string; action?: React.ReactNode }> = [
    { name: 'Gemini', icon: Sparkles, ok: i.gemini, what: 'Triage, photo quotes, voice calls, copilot', how: 'GEMINI_API_KEY' },
    { name: 'Telegram', icon: Send, ok: i.telegram, what: 'Technician app and owner alerts', how: 'TELEGRAM_BOT_TOKEN' },
    {
      name: 'Google',
      icon: Mail,
      ok: !!i.googleAccount,
      what: i.googleAccount ? `Gmail and Calendar as ${i.googleAccount}` : 'Email intake, replies, calendar',
      how: i.google ? 'Connect your account' : 'GOOGLE_CLIENT_ID / SECRET',
      action: i.google ? (
        <Button variant="outline" size="sm" asChild>
          <a href="/api/google/start">{i.googleAccount ? 'Reconnect' : 'Connect'}</a>
        </Button>
      ) : undefined,
    },
    { name: 'Stripe', icon: CreditCard, ok: i.stripe, what: 'Payment links (test mode)', how: 'STRIPE_SECRET_KEY=sk_test_…' },
    { name: 'OpenRouteService', icon: RouteIcon, ok: i.ors, what: 'Real drive times between jobs', how: 'ORS_API_KEY · estimates without it' },
    { name: 'Open-Meteo + Nominatim', icon: MapPinned, ok: true, what: 'Weather and address lookup', how: 'No key needed' },
  ]
  return (
    <div className="space-y-4">
      <Muted className="block">Every integration is optional. Without one, the feature falls back and the demo keeps working. Keys go in the server’s .env file.</Muted>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.name}>
            <Card size="sm" className="h-full">
              <CardContent className="flex h-full flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="tile tile-quiet size-10 shrink-0 rounded-xl">
                    <it.icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{it.what}</div>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      it.ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-foreground/8 text-muted-foreground',
                    )}
                  >
                    {it.ok ? <Check className="size-3" /> : <CircleDashed className="size-3" />}
                    {it.ok ? 'On' : 'Off'}
                  </span>
                </div>
                {(!it.ok || it.action) && (
                  <div className="mt-auto flex items-center gap-2">
                    {!it.ok && (
                      <code className="well inline-flex min-w-0 items-center gap-1.5 truncate rounded-lg px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        <KeyRound className="size-3 shrink-0" /> {it.how}
                      </code>
                    )}
                    <span className="ml-auto">{it.action}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Automation ---------- */

type WeatherMode = 'cold_snap' | 'heat_wave' | 'off'

function Automation() {
  const snap = useSnap()
  const confirm = useConfirm()
  const cron = useAction((name: 'tick' | 'morning' | 'weather') => runCronNow({ data: { name } }))
  const weather = useAction((mode: WeatherMode) => setWeather({ data: { mode } }))
  const ov = snap.weather?.override
  const mode: WeatherMode = ov ? (ov.tempC < 0 ? 'cold_snap' : ov.tempC > 20 ? 'heat_wave' : 'off') : 'off'

  const run = async (k: 'tick' | 'morning' | 'weather') => {
    if (k === 'morning') {
      const ok = await confirm({
        title: 'Run the morning plan now?',
        description: 'The day is re-planned, every technician gets their route in Telegram, and the owner group gets a summary.',
        confirm: 'Run now',
        icon: Play,
      })
      if (!ok) return
    }
    cron.run(k)
  }

  const jobs = [
    ['tick', 'Watchdog', 'Every minute', 'Checks the inbox, SLA alerts, queued work and payments'],
    ['morning', 'Morning plan', 'Daily 6:30', 'Re-plans the day, sends each tech their route, briefs the owner'],
    ['weather', 'Weather scan', 'Daily 6:00', 'Cold snap or heat wave ahead: drafts a maintenance campaign for approval'],
  ] as const

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Scheduled jobs</h2>
          <Muted className="max-sm:hidden">Run by Cloud Scheduler in production</Muted>
        </div>
        <ul className="divide-y">
          {jobs.map(([k, title, when, desc]) => (
            <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <span className="tile tile-quiet size-9 shrink-0">
                <Clock className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {title}
                  <span className="well rounded-full px-2 py-0.5 text-[11px] font-normal text-muted-foreground">{when}</span>
                </div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <Button variant="outline" size="sm" disabled={cron.busy} onClick={() => run(k)}>
                <Play /> Run now
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <ErrorText error={cron.error} />

      <Card size="sm">
        <CardContent className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Demo weather</h2>
            <Muted className="block">Pretend a cold snap or heat wave is here. Triage, the weather scan and the copilot all use it.</Muted>
          </div>
          <fieldset aria-label="Demo weather" className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['off', CloudSun, 'Real weather', 'Live Denver forecast'],
                ['cold_snap', Snowflake, 'Cold snap', '−14°C, furnaces fail'],
                ['heat_wave', Sun, 'Heat wave', '36°C, AC calls spike'],
              ] as const
            ).map(([v, I, title, sub]) => (
              <label
                key={v}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                  mode === v ? 'border-primary bg-primary/5' : 'hover:bg-secondary',
                  weather.busy && 'pointer-events-none opacity-60',
                )}
              >
                <input type="radio" name="weather" className="sr-only" checked={mode === v} onChange={() => weather.run(v)} />
                <I className={cn('size-5 shrink-0', mode === v ? 'text-primary' : 'text-muted-foreground')} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <ErrorText error={weather.error} />
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------- Demo ---------- */

function Demo() {
  const confirm = useConfirm()
  const reset = useAction(() => resetDemo())
  const ask = async () => {
    const ok = await confirm({
      title: 'Reset all demo data?',
      description:
        'Jobs, requests, invoices and traces are wiped and re-seeded. Permissions and the agent persona go back to defaults. Telegram links and the Google connection are kept.',
      confirm: 'Reset',
      tone: 'danger',
      icon: RotateCcw,
    })
    if (ok) reset.run()
  }
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-4">
        <span className="tile tile-red size-10 shrink-0 rounded-xl">
          <RotateCcw className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Reset the demo company</h2>
          <Muted className="block">Back to 5 technicians, 40 fictional customers and a partly booked schedule for the next 3 days.</Muted>
        </div>
        <Button variant="destructive" disabled={reset.busy} onClick={ask}>
          {reset.busy ? 'Resetting…' : 'Reset'}
        </Button>
        <ErrorText error={reset.error} />
      </CardContent>
    </Card>
  )
}
