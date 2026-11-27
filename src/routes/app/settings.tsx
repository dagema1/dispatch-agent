import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Ban,
  Bot,
  Building2,
  CalendarClock,
  Camera,
  Check,
  CircleDashed,
  Clock,
  CloudSun,
  CreditCard,
  Database,
  Hand,
  Inbox,
  KeyRound,
  LayoutList,
  Mail,
  MapPinned,
  MessageSquare,
  Play,
  Plug,
  RotateCcw,
  Route as RouteIcon,
  ScrollText,
  Send,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sun,
  Tags,
  Wallet,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { addDemoQuote, getSetup, postOfficeBoard, releaseCapacity, resetDemo, runCronNow, saveApiKeys, saveCompany, setOfficeLog, setPolicy, setSandbox, setWeather } from '#/fns'
import { ApiKeyFields, type KeyPatch, type KeyStatus, typedKeys } from '#/ui/ApiKeys'
import { ErrorText, Muted, PageTitle, PanelHead } from '#/ui/bits'
import { CompanyFields, type CompanyValues } from '#/ui/CompanyForm'
import { useConfirm } from '#/ui/confirm'
import { useAction, useSnap } from '#/ui/live'
import { PersonaSettings } from '#/ui/PersonaSettings'
import { PriceBook } from '#/ui/PriceBook'
import { SegmentedNav, TabPanel } from '#/ui/SegmentedNav'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const TABS = ['company', 'persona', 'permissions', 'pricing', 'integrations', 'automation', 'demo'] as const
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
      ['reply_outside_area', 'Turn away out-of-area requests', 'Reply that we can’t serve the address. Off: the office decides'],
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
  company: { label: 'Company', icon: Building2 },
  pricing: { label: 'Price book', icon: Tags },
  persona: { label: 'Persona', icon: Bot },
  permissions: { label: 'Permissions', icon: ShieldCheck },
  integrations: { label: 'Integrations', icon: Plug },
  automation: { label: 'Automation', icon: Clock },
  demo: { label: 'Demo data', icon: Database },
}

function SettingsPage() {
  const raw = Route.useSearch().tab
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'company'

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle title="Settings" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <SegmentedNav
          label="Settings sections"
          active={tab}
          items={TABS.map((t) => ({ key: t, label: NAV[t].label, icon: NAV[t].icon, link: { to: '/app/settings', search: { tab: t } } }))}
        />
        <TabPanel order={TABS} active={tab}>
          {tab === 'company' && <Company />}
          {tab === 'pricing' && <PriceBook />}
          {tab === 'persona' && <PersonaSettings />}
          {tab === 'permissions' && <Permissions />}
          {tab === 'integrations' && <Integrations />}
          {tab === 'automation' && <Automation />}
          {tab === 'demo' && <Demo />}
        </TabPanel>
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
          <PanelHead icon={g.icon} title={g.title} />
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
    { name: 'Telegram', icon: Send, ok: i.telegram, what: 'Technician app, owner alerts and the office group log', how: 'TELEGRAM_BOT_TOKEN' },
    {
      name: 'Google',
      icon: Mail,
      ok: !!i.googleAccount,
      what: i.googleAccount ? `Gmail and Calendar as ${i.googleAccount}` : 'Email intake, replies, calendar',
      how: i.google ? 'Connect your account' : 'Needs Google keys in the server setup',
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
      <Muted className="block">Every integration is optional. Without one, the feature falls back and the demo keeps working. Add keys at the bottom of this page.</Muted>
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
      <TestInbox />
      <OfficeLog />
      <LiveBoard />
      <Keys />
    </div>
  )
}

/** Where customer messages go when no email or text provider is connected. */
function TestInbox() {
  const snap = useSnap()
  const on = (snap.settings as { sandbox?: { testInbox: boolean } }).sandbox?.testInbox ?? true
  const save = useAction((v: boolean) => setSandbox({ data: { testInbox: v } }))
  return (
    <SwitchCard icon={Inbox} title="Test inbox" on={on} save={save}>
      With no Gmail or text provider, customer emails and texts are delivered to the test inbox in Simulators, and marked as test deliveries. Off: they wait in the outbox as not
      delivered.
    </SwitchCard>
  )
}

/** The office Telegram group as a running dispatch log. */
function OfficeLog() {
  const snap = useSnap()
  const on = (snap.settings as { officeLog?: { telegram: boolean } }).officeLog?.telegram ?? true
  const save = useAction((v: boolean) => setOfficeLog({ data: { telegram: v } }))
  return (
    <SwitchCard icon={ScrollText} title="Office group log" on={on} save={save}>
      Posts every booking, technician assignment and slot change to the office Telegram group, plus what technicians are sent and report: accepted, on the way, on site, running
      late, notes, done. Changes that land together go out as one silent message.
    </SwitchCard>
  )
}

/** The pinned live board widget in the office group: posted with /menu, or from here. */
function LiveBoard() {
  const [note, setNote] = useState<string | null>(null)
  const post = useAction(async () => {
    const r = await postOfficeBoard()
    setNote(
      r.ok
        ? r.kind === 'text'
          ? 'Posted and pinned as a text board: Telegram allows widgets only in private chats for now, so the group gets the same board as a message that edits itself.'
          : 'Posted and pinned in the office group.'
        : r.reason,
    )
    return r
  })
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-4">
        <span className="tile tile-action size-10 shrink-0 rounded-xl">
          <LayoutList className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Live board in Telegram</h2>
          <Muted className="block">
            A pinned widget in the office group with every technician’s day, unassigned visits and pending approvals. It updates in place; tap a technician for their route, or
            re-plan from it. /menu in the group posts it too.
          </Muted>
          {note && (
            <output aria-live="polite" className="mt-1 block text-xs text-muted-foreground">
              {note}
            </output>
          )}
        </div>
        <Button size="sm" variant="outline" disabled={post.busy} onClick={() => post.run()}>
          <Send /> {post.busy ? 'Posting…' : 'Post to group'}
        </Button>
        <ErrorText error={post.error} />
      </CardContent>
    </Card>
  )
}

function SwitchCard({
  icon: I,
  title,
  on,
  save,
  children,
}: {
  icon: Icon
  title: string
  on: boolean
  save: { run: (v: boolean) => unknown; busy: boolean; error: string | null }
  children: React.ReactNode
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-4">
        <span className="tile tile-action size-10 shrink-0 rounded-xl">
          <I className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Muted className="block">{children}</Muted>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={on ? 'on' : 'off'} onValueChange={(v) => v && save.run(v === 'on')} disabled={save.busy} aria-label={title}>
          <ToggleGroupItem value="on" className="px-3">
            On
          </ToggleGroupItem>
          <ToggleGroupItem value="off" className="px-3">
            Off
          </ToggleGroupItem>
        </ToggleGroup>
        <ErrorText error={save.error} />
      </CardContent>
    </Card>
  )
}

function Keys() {
  const [keys, setKeys] = useState<KeyStatus[] | null>(null)
  const [v, setV] = useState<KeyPatch>({})
  const [saved, setSaved] = useState(false)
  const load = () => getSetup().then((d) => setKeys(d.keys as KeyStatus[]))
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open
  useEffect(() => {
    load().catch(() => {})
  }, [])
  const save = useAction(async () => {
    await saveApiKeys({ data: typedKeys(v) })
    setV({})
    setSaved(true)
    await load()
  })
  const dirty = Object.keys(typedKeys(v)).length > 0
  return (
    <Card className="gap-0 py-0">
      <PanelHead
        icon={KeyRound}
        title="API keys"
        sub="Saved keys override the server’s defaults and apply straight away. A new Telegram bot token needs a server restart."
        right={
          <Button
            disabled={!dirty || save.busy}
            onClick={() => {
              setSaved(false)
              save.run()
            }}
          >
            {save.busy ? (
              'Saving…'
            ) : saved && !dirty ? (
              <>
                <Check /> Saved
              </>
            ) : (
              'Save keys'
            )}
          </Button>
        }
      />
      <CardContent className="py-4">
        {keys ? <ApiKeyFields keys={keys} value={v} onChange={setV} /> : <Muted>Loading…</Muted>}
        <ErrorText error={save.error} />
      </CardContent>
    </Card>
  )
}

/* ---------- Company ---------- */

function Company() {
  const snap = useSnap()
  const s = snap.settings as unknown as { company: CompanyValues['company']; hours: CompanyValues['hours'] }
  const [v, setV] = useState<CompanyValues>({
    company: { name: s.company.name, phone: s.company.phone, email: s.company.email ?? '', address: s.company.address ?? '', serviceRadiusKm: s.company.serviceRadiusKm },
    hours: s.hours,
  })
  const [done, setDone] = useState<string | null>(null)
  const save = useAction(async () => {
    const r = await saveCompany({ data: v })
    setDone(r.located ? 'Saved.' : 'Saved, but the address could not be found on the map; the service area still uses the old location.')
  })
  return (
    <Card className="gap-0 py-0">
      <PanelHead title="Company" sub="Used in every customer message, call and page." />
      <CardContent className="py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setDone(null)
            save.run()
          }}
          className="space-y-5"
        >
          <CompanyFields value={v} onChange={setV} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.busy}>
              {save.busy ? 'Saving…' : 'Save company'}
            </Button>
            {done && <Muted>{done}</Muted>}
            <ErrorText error={save.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/* ---------- Automation ---------- */

type WeatherMode = 'cold_snap' | 'heat_wave' | 'off'

/** Emergency capacity the weather scan held back; shown only while it is active. */
function CapacityReserve() {
  const snap = useSnap()
  const cap = (snap.settings as { capacity?: { reserveMin: number; until: string; reason: string } }).capacity
  const release = useAction(() => releaseCapacity())
  const today = new Intl.DateTimeFormat('en-CA').format(new Date())
  if (!cap?.reserveMin || !cap.until || cap.until < today) return null
  return (
    <Card size="sm" className="border-(--attn-2)/40">
      <CardContent className="flex flex-wrap items-center gap-4">
        <span className="tile tile-attn size-10 shrink-0 rounded-xl">{cap.reason === 'heat_wave' ? <Sun className="size-5" /> : <Snowflake className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Emergency capacity held</h2>
          <Muted className="block">
            {cap.reason === 'heat_wave' ? 'Heat wave' : 'Cold snap'} ahead: the last {cap.reserveMin} min of every technician’s day only takes P1 emergencies, through {cap.until}.
          </Muted>
        </div>
        <Button size="sm" variant="outline" disabled={release.busy} onClick={() => release.run()}>
          {release.busy ? 'Releasing…' : 'Release'}
        </Button>
        <ErrorText error={release.error} />
      </CardContent>
    </Card>
  )
}

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
    ['tick', 'Watchdog', 'Every minute', 'Checks the inbox, SLA alerts, visit reminders for tomorrow, queued work and payments'],
    ['morning', 'Morning plan', 'Daily 6:30', 'Re-plans the day, sends each tech their route, briefs the owner (Telegram, and email when Gmail is connected)'],
    ['weather', 'Weather scan', 'Daily 17:00', 'Cold snap or heat wave ahead: holds emergency capacity and drafts a maintenance campaign for approval'],
  ] as const

  return (
    <div className="space-y-4">
      <CapacityReserve />
      <Card className="gap-0 py-0">
        <PanelHead title="Scheduled jobs" right={<Muted className="max-sm:hidden">Run by Cloud Scheduler in production</Muted>} />
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

      <Card className="gap-0 py-0">
        <PanelHead title="Demo weather" sub="Pretend a cold snap or heat wave is here. Triage, the weather scan and the copilot all use it." />
        <CardContent className="space-y-3 py-4">
          <fieldset aria-label="Demo weather" className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['off', CloudSun, 'Real weather', 'Live Denver forecast'],
                ['cold_snap', Snowflake, 'Cold snap', '0°F, furnaces fail'],
                ['heat_wave', Sun, 'Heat wave', '97°F, AC calls spike'],
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
  const navigate = useNavigate()
  const reset = useAction(async () => {
    await resetDemo()
    navigate({ to: '/setup' })
  })
  const ask = async () => {
    const ok = await confirm({
      title: 'Reset all demo data?',
      description:
        'Jobs, requests, invoices and traces are wiped. Company details, permissions and the persona go back to defaults, and setup starts again. Saved API keys, Telegram links and the Google connection are kept.',
      confirm: 'Reset',
      tone: 'danger',
      icon: RotateCcw,
    })
    if (ok) reset.run()
  }
  const quote = useAction(async () => {
    await addDemoQuote()
    navigate({ to: '/app/money' })
  })
  return (
    <div className="space-y-3">
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-4">
          <span className="tile tile-action size-10 shrink-0 rounded-xl">
            <Camera className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Add a sample photo quote</h2>
            <Muted className="block">A 17-year-old furnace diagnosed from photos, quoted good, better and best from the price book. Nothing else changes.</Muted>
          </div>
          <Button variant="outline" disabled={quote.busy} onClick={() => quote.run()}>
            {quote.busy ? 'Adding…' : 'Add quote'}
          </Button>
          <ErrorText error={quote.error} />
        </CardContent>
      </Card>
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
    </div>
  )
}
