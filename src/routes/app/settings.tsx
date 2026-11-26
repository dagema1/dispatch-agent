import { createFileRoute } from '@tanstack/react-router'
import { Check, CircleDashed, CloudSun, Play, RotateCcw, ShieldCheck, Snowflake, Sun } from 'lucide-react'
import { resetDemo, runCronNow, setPolicy, setWeather } from '#/fns'
import { ErrorText, Muted, PageTitle, Section } from '#/ui/bits'
import { useConfirm } from '#/ui/confirm'
import { useAction, useSnap } from '#/ui/live'
import { PersonaSettings } from '#/ui/PersonaSettings'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
})

const POLICY_LABEL: Record<string, string> = {
  send_customer_message: 'Reply to customers',
  book_job: 'Book jobs',
  replan_day: 'Re-plan the day',
  move_booked_job: 'Move a booked visit to another day',
  after_hours_dispatch: 'Dispatch a tech after hours',
  send_quote: 'Send quotes',
  send_invoice: 'Send invoices',
  send_payment_reminder: 'Send payment reminders',
  send_campaign: 'Send marketing campaigns',
  apply_discount: 'Apply a discount',
  refund: 'Issue refunds',
  price_outside_book: 'Charge a price outside the price book',
}

const POLICY_ON: Record<string, string> = {
  auto: 'data-[state=on]:text-primary data-[state=on]:font-semibold',
  approve: 'data-[state=on]:text-amber-700 dark:data-[state=on]:text-amber-300 data-[state=on]:font-semibold',
  never: 'data-[state=on]:font-semibold',
}

type WeatherMode = 'cold_snap' | 'heat_wave' | 'off'

function SettingsPage() {
  const snap = useSnap()
  const pol = useAction((key: string, value: 'auto' | 'approve' | 'never') => setPolicy({ data: { key, value } }))
  const cron = useAction((name: 'tick' | 'morning' | 'weather') => runCronNow({ data: { name } }))
  const weather = useAction((mode: WeatherMode) => setWeather({ data: { mode } }))
  const reset = useAction(() => resetDemo())
  const confirm = useConfirm()
  const askPolicy = async (k: string, o: 'auto' | 'approve' | 'never') => {
    if (o === 'auto') {
      const ok = await confirm({
        title: `Let agents do this on their own?`,
        description: `“${POLICY_LABEL[k] ?? k}” will run without asking you, unless model confidence is low.`,
        confirm: 'Allow',
        tone: 'attn',
        icon: ShieldCheck,
      })
      if (!ok) return
    }
    pol.run(k, o)
  }
  const askCron = async (k: 'tick' | 'morning' | 'weather') => {
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
  const askReset = async () => {
    const ok = await confirm({
      title: 'Reset all demo data?',
      description: 'Jobs, requests, invoices and traces are wiped and re-seeded. Telegram links and the Google connection are kept.',
      confirm: 'Reset',
      tone: 'danger',
      icon: RotateCcw,
    })
    if (ok) reset.run()
  }
  const i = snap.integrations
  const ov = snap.weather?.override
  const weatherMode: WeatherMode = ov ? (ov.tempC < 0 ? 'cold_snap' : ov.tempC > 20 ? 'heat_wave' : 'off') : 'off'
  const items = [
    ['Gemini', i.gemini, 'triage, vision quotes, voice, copilot', 'GEMINI_API_KEY'],
    ['Telegram', i.telegram, 'technician app, owner alerts', 'TELEGRAM_BOT_TOKEN'],
    ['OpenRouteService', i.ors, 'real drive-time matrices', 'ORS_API_KEY (falls back to estimates)'],
    ['Stripe (test mode)', i.stripe, 'payment links', 'STRIPE_SECRET_KEY=sk_test_…'],
    [
      'Google (Gmail + Calendar)',
      !!i.googleAccount,
      i.googleAccount ? `connected as ${i.googleAccount}` : 'email intake, replies, calendar',
      i.google ? 'click Connect' : 'GOOGLE_CLIENT_ID / SECRET',
    ],
    ['Open-Meteo + Nominatim', true, 'weather and geocoding', 'no key needed'],
  ] as const
  return (
    <div>
      <PageTitle title="Settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <PersonaSettings />
        <Section title="Integrations">
          <ul className="space-y-3">
            {items.map(([name, ok, what, how]) => (
              <li key={name} className="flex items-start gap-2.5 text-sm">
                <span className={cn('tile size-8 shrink-0', ok ? 'tile-action' : 'tile-quiet')} role="img" aria-label={ok ? 'connected' : 'not set up'}>
                  {ok ? <Check className="size-4" /> : <CircleDashed className="size-4" />}
                </span>
                <div className="flex-1">
                  <div className="font-medium">{name}</div>
                  <Muted>
                    {what}
                    {!ok && ` · set ${how}`}
                  </Muted>
                </div>
                {name.startsWith('Google') && i.google && (
                  <Button variant="outline" size="sm" asChild>
                    <a href="/api/google/start">{i.googleAccount ? 'Reconnect' : 'Connect'}</a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Proactive jobs" right={<Muted>Cloud Scheduler → /api/cron/…</Muted>}>
          <ul className="space-y-3 text-sm">
            {(
              [
                ['tick', 'Watchdog · every minute', 'Poll inbox, SLA alerts, queued work, payment status'],
                ['morning', 'Morning plan · 06:30', 'Re-plan the day, send each tech their route, owner summary'],
                ['weather', 'Weather scan · 06:00', 'Cold snap / heat wave → targeted maintenance campaign (needs approval)'],
              ] as const
            ).map(([k, title, desc]) => (
              <li key={k} className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="font-medium">{title}</div>
                  <Muted>{desc}</Muted>
                </div>
                <Button variant="outline" size="sm" disabled={cron.busy} onClick={() => askCron(k)}>
                  <Play /> Run now
                </Button>
              </li>
            ))}
          </ul>
          <ErrorText error={cron.error} />
          <Separator className="my-4" />
          <div className="text-sm font-semibold">Demo weather</div>
          <Muted className="block">Pretend a cold snap or heat wave is here: triage, the weather scan and the copilot all use it.</Muted>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            className="mt-2"
            value={weatherMode}
            disabled={weather.busy}
            onValueChange={(v) => v && v !== weatherMode && weather.run(v as WeatherMode)}
          >
            <ToggleGroupItem value="cold_snap">
              <Snowflake /> Cold snap
            </ToggleGroupItem>
            <ToggleGroupItem value="heat_wave">
              <Sun /> Heat wave
            </ToggleGroupItem>
            <ToggleGroupItem value="off">
              <CloudSun /> Real weather
            </ToggleGroupItem>
          </ToggleGroup>
          <ErrorText error={weather.error} />
        </Section>

        <Section title="What the agents may do on their own" className="xl:col-span-2">
          <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {Object.entries(snap.settings.policies).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-sm">
                <span>{POLICY_LABEL[k] ?? k}</span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={v}
                  disabled={pol.busy}
                  aria-label={POLICY_LABEL[k] ?? k}
                  onValueChange={(o) => o && o !== v && askPolicy(k, o as 'auto' | 'approve' | 'never')}
                >
                  {(['auto', 'approve', 'never'] as const).map((o) => (
                    <ToggleGroupItem key={o} value={o} className={cn('px-2.5 text-xs', POLICY_ON[o])}>
                      {o}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            ))}
          </div>
          <Muted className="mt-3 block">Any “auto” action is held for approval when model confidence is below {snap.settings.thresholds.minConfidence}.</Muted>
          <ErrorText error={pol.error} />
        </Section>

        <Section title="Demo data" className="xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="destructive" disabled={reset.busy} onClick={askReset}>
              <RotateCcw /> {reset.busy ? 'Resetting…' : 'Reset demo company'}
            </Button>
            <Muted>5 technicians, 40 fictional customers, a partly booked schedule for the next 3 days.</Muted>
          </div>
          <ErrorText error={reset.error} />
        </Section>
      </div>
    </div>
  )
}
