import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, Building2, Check, CircleDashed, Database, Sparkles, Wrench } from 'lucide-react'
import { useState } from 'react'
import { completeSetup, getSession, getSetup } from '#/fns'
import { ApiKeyFields, type KeyPatch, type KeyStatus, typedKeys } from '#/ui/ApiKeys'
import { Backdrop } from '#/ui/Backdrop'
import { CompanyFields, type CompanyValues } from '#/ui/CompanyForm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    if (!(await getSession()).owner) throw redirect({ to: '/' })
  },
  loader: () => getSetup(),
  component: Setup,
  ssr: false,
  head: () => ({ meta: [{ title: 'Set up · Front office' }] }),
})

type Mode = 'demo' | 'own'
const STEPS = ['Start', 'Company', 'Integrations', 'Ready'] as const

const DEMO: CompanyValues = {
  company: { name: 'Northline Heating & Plumbing', phone: '(720) 555-0142', email: 'office@northline.example.com', address: '1600 Broadway, Denver, CO', serviceRadiusKm: 35 },
  hours: { open: '08:00', close: '17:00' },
}

const SERVICES: Array<{ key: keyof Integrations; name: string; what: string }> = [
  { key: 'gemini', name: 'Gemini', what: 'Triage, photo quotes, voice calls' },
  { key: 'telegram', name: 'Telegram', what: 'Technician app, owner alerts' },
  { key: 'stripe', name: 'Stripe (test)', what: 'Payment links' },
  { key: 'ors', name: 'OpenRouteService', what: 'Real drive times' },
  { key: 'google', name: 'Google', what: 'Gmail and Calendar' },
]
type Integrations = { gemini: boolean; telegram: boolean; ors: boolean; stripe: boolean; google: boolean }

/**
 * First run, and after a reset: what the agents need to know before they answer a single
 * customer. Demo runs on the fictional company and the server's keys; "my company" starts empty
 * and asks for the owner's own keys.
 */
function Setup() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<Mode>(data.setup.mode)
  const [fresh, setFresh] = useState(true)
  const [values, setValues] = useState<CompanyValues>(() => ({
    company: { ...data.company, email: data.company.email ?? '', address: data.company.address ?? '' },
    hours: data.hours,
  }))
  const [keys, setKeys] = useState<KeyPatch>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = (m: Mode) => {
    setMode(m)
    // the demo company comes with its details; your own starts from whatever is saved
    if (m === 'demo') setValues(DEMO)
  }
  const companyOk = values.company.name.trim().length >= 2 && values.company.phone.trim().length >= 7 && values.company.address.trim().length >= 5
  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      await completeSetup({ data: { mode, loadData: fresh, ...values, keys: mode === 'own' ? typedKeys(keys) : undefined } })
      await router.navigate({ to: '/app' })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dark relative min-h-dvh overflow-x-hidden bg-background px-4 py-10 text-foreground">
      <Backdrop />
      <main className="relative mx-auto w-full max-w-3xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="tile tile-solid size-11 rounded-full">
            <Wrench className="size-5" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            Set up your <span className="font-display text-[1.15em] text-primary">front office</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">A few details before the agents answer their first customer.</p>
        </div>

        <ol className="mb-6 flex items-center justify-center gap-2" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors',
                  i === step ? 'bg-foreground/11 font-medium text-foreground shadow-[inset_0_1px_0_var(--edge)]' : i < step ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'grid size-4 place-items-center rounded-full text-[10px] tabular-nums',
                    i < step ? 'bg-primary text-primary-foreground' : i === step ? 'bg-primary/20 text-primary' : 'bg-foreground/8',
                  )}
                >
                  {i < step ? <Check className="size-2.5" /> : i + 1}
                </span>
                <span className="max-sm:hidden">{s}</span>
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-border sm:w-8" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        <section key={step} className="route-in slab rounded-3xl border p-5 sm:p-7">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">How do you want to start?</h2>
                <p className="text-sm text-muted-foreground">You can switch later by resetting from Settings.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  on={mode === 'demo'}
                  onClick={() => pick('demo')}
                  icon={Sparkles}
                  title="Demo company"
                  body="Northline Heating & Plumbing in Denver: 5 technicians, 40 fictional customers, a partly booked week. Uses the server’s API keys."
                />
                <ModeCard
                  on={mode === 'own'}
                  onClick={() => pick('own')}
                  icon={Building2}
                  title="My company"
                  body="Your name, address and keys. Starts with no customers or jobs; sample technicians and a starter price book you can edit."
                />
              </div>
              <label className="well flex cursor-pointer items-start gap-3 rounded-2xl p-3.5 text-sm">
                <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} className="mt-0.5 size-4 accent-(--primary)" />
                <span>
                  <span className="font-medium">Start from clean data</span>
                  <span className="block text-xs text-muted-foreground">
                    {mode === 'demo' ? 'Re-load the demo schedule for today.' : 'Remove demo customers, jobs and history.'} Untick to keep what is there now.
                  </span>
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Your company</h2>
                <p className="text-sm text-muted-foreground">Customers hear and see this in every call, text and page.</p>
              </div>
              <CompanyFields value={values} onChange={setValues} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Integrations</h2>
                <p className="text-sm text-muted-foreground">
                  {mode === 'demo'
                    ? 'The demo runs on the keys this server was started with. Anything off falls back to rules and estimates.'
                    : 'Paste the keys you have. All optional: without one, that feature falls back and nothing breaks. Empty fields keep the server’s default.'}
                </p>
              </div>
              {mode === 'demo' ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {SERVICES.map((sv) => {
                    const on = data.integrations[sv.key]
                    return (
                      <li key={sv.key} className="well flex items-center gap-3 rounded-2xl p-3">
                        <span className={cn('tile size-8 shrink-0 rounded-lg', on ? 'tile-action' : 'tile-quiet')}>
                          {on ? <Check className="size-4" /> : <CircleDashed className="size-4" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{sv.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{on ? sv.what : 'Off: falls back'}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <ApiKeyFields keys={data.keys as KeyStatus[]} value={keys} onChange={setKeys} />
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Ready</h2>
                <p className="text-sm text-muted-foreground">Check the essentials, then open the dispatch board.</p>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <Row label="Starting with" value={mode === 'demo' ? 'Demo company' : 'My company'} />
                <Row label="Data" value={fresh ? (mode === 'demo' ? 'Fresh demo week' : 'Empty, sample techs') : 'Keep current'} />
                <Row label="Company" value={values.company.name} />
                <Row label="Office phone" value={values.company.phone} />
                <Row label="Shop" value={values.company.address} />
                <Row label="Hours" value={`${values.hours.open} to ${values.hours.close}`} />
                <Row
                  label="Keys"
                  value={mode === 'demo' ? 'Server defaults' : `${Object.keys(typedKeys(keys)).length} new, rest from server`}
                  icon={mode === 'demo' ? Database : undefined}
                />
              </dl>
              {fresh && <p className="text-xs text-muted-foreground">Finishing replaces the current customers, jobs and history.</p>}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          <div className="mt-7 flex items-center gap-2 border-t border-(--edge) pt-5">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                <ArrowLeft /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button className="ml-auto" onClick={() => setStep(step + 1)} disabled={step === 1 && !companyOk}>
                Continue <ArrowRight />
              </Button>
            ) : (
              <Button size="lg" className="ml-auto" onClick={finish} disabled={busy || !companyOk}>
                {busy ? 'Setting up…' : 'Open the board'} {!busy && <ArrowRight />}
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function ModeCard({ on, onClick, icon: Icon, title, body }: { on: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex h-full flex-col gap-3 rounded-2xl border p-4 text-left transition-[background-color,border-color,scale] active:scale-[0.99]',
        on ? 'border-primary/60 bg-primary/10' : 'border-border bg-foreground/3 hover:bg-foreground/6',
      )}
    >
      <span className="flex items-center gap-2.5">
        <span className={cn('tile size-9 rounded-xl', on ? 'tile-solid' : 'tile-quiet')}>
          <Icon className="size-4" />
        </span>
        <span className="text-sm font-semibold">{title}</span>
        <span className={cn('ml-auto grid size-5 place-items-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
          {on && <Check className="size-3" />}
        </span>
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
    </button>
  )
}

function Row({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="well flex items-center justify-between gap-3 rounded-xl px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 truncate font-medium">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {value}
      </dd>
    </div>
  )
}
