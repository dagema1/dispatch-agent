import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, Eye, Save, Zap } from 'lucide-react'
import { useState } from 'react'
import { setAgentConfig } from '#/fns'
import type { AgentConfig } from '#/server/domain/settings'
import { AgentsTabs } from '#/ui/AgentsTabs'
import { AgentTile, ErrorText, Muted, PageTitle } from '#/ui/bits'
import { useConfirm } from '#/ui/confirm'
import { AGENT_LABEL, ago, aiCost, usd } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/team')({ component: Team })

type AgentKey = 'front_desk' | 'diagnosis' | 'dispatch' | 'revenue' | 'ops'

/** What each specialist does, which permissions it acts under, and whether it uses a model prompt at all. */
const ROSTER: Array<{ key: AgentKey; role: string; does: string; policies: string[]; usesModel: boolean; placeholder: string }> = [
  {
    key: 'front_desk',
    role: 'Receptionist',
    does: 'Answers email, web and phone. Triages urgency and safety, books the visit and confirms with the customer.',
    policies: ['Reply to customers', 'Book jobs'],
    usesModel: true,
    placeholder: 'e.g. Always mention we offer financing on replacements. Never book drain jobs on Sundays.',
  },
  {
    key: 'diagnosis',
    role: 'Photo diagnosis',
    does: 'Reads customer photos, identifies the unit and its age, and builds good, better, best quotes from the price book.',
    policies: ['Send quotes'],
    usesModel: true,
    placeholder: 'e.g. Flag any unit older than 12 years as a replacement lead.',
  },
  {
    key: 'dispatch',
    role: 'Dispatcher',
    does: 'Plans routes across the crew, re-plans when something changes, and sends each technician their day.',
    policies: ['Re-plan the day', 'Move a booked visit', 'After-hours dispatch'],
    usesModel: false,
    placeholder: '',
  },
  {
    key: 'revenue',
    role: 'Billing',
    does: 'Turns technician voice notes into job reports and invoices, then sends payment links and reminders.',
    policies: ['Send invoices', 'Payment reminders', 'Discounts', 'Refunds'],
    usesModel: true,
    placeholder: 'e.g. Add the trip charge on every after-hours job.',
  },
  {
    key: 'ops',
    role: 'Operations',
    does: 'The Agent chat and the Telegram office panel: answers your questions, runs the morning plan and weather campaigns.',
    policies: ['Marketing campaigns'],
    usesModel: true,
    placeholder: 'e.g. Keep answers under three sentences. Use 24-hour times.',
  },
]

function Team() {
  const snap = useSnap()
  const name = (snap.settings.persona as { agentName: string }).agentName
  const configs = snap.settings.agents as Record<string, AgentConfig>
  const supervised = ROSTER.filter((r) => configs[r.key]?.supervised).length
  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle
        title="Agent team"
        sub={`Five specialists behind ${name}. Customers only ever meet ${name}.`}
        right={
          <span className="well inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs">
            <span className={cn('size-2 rounded-full', supervised ? 'bg-(--attn-2)' : 'bg-primary')} aria-hidden />
            {supervised ? `${supervised} supervised` : 'All autonomous'}
          </span>
        }
      />
      <AgentsTabs />
      <ul className="grid gap-4 xl:grid-cols-2">
        {ROSTER.map((r) => (
          <li key={r.key}>
            <AgentCard r={r} cfg={configs[r.key] ?? { supervised: false, instructions: '' }} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function AgentCard({ r, cfg }: { r: (typeof ROSTER)[number]; cfg: AgentConfig }) {
  const snap = useSnap()
  const confirm = useConfirm()
  const [notes, setNotes] = useState(cfg.instructions)
  const save = useAction((next: AgentConfig) => setAgentConfig({ data: { agent: r.key, ...next } }))
  const runs = snap.runs.filter((x) => x.agent === r.key)
  const failed = runs.filter((x) => x.status === 'failed').length
  const cost = runs.reduce((a, x) => a + aiCost(x.tokensIn, x.tokensOut), 0)
  const last = runs[0]
  const dirty = notes.trim() !== cfg.instructions.trim()

  const toggle = async () => {
    const next = !cfg.supervised
    const ok = await confirm(
      next
        ? {
            title: `Supervise the ${AGENT_LABEL[r.key]} agent?`,
            description: 'Everything it would do on its own waits in Approvals until you say yes.',
            confirm: 'Supervise',
            tone: 'attn',
            icon: Eye,
          }
        : {
            title: `Let the ${AGENT_LABEL[r.key]} agent work on its own?`,
            description: 'It goes back to following the Permissions in Settings.',
            confirm: 'Allow',
            icon: Zap,
          },
    )
    if (ok) save.run({ supervised: next, instructions: cfg.instructions })
  }

  return (
    <Card className="h-full gap-0 py-0">
      <div className="flex items-start gap-3 p-5">
        <AgentTile agent={r.key} className="size-11 rounded-xl [&_svg]:size-5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{AGENT_LABEL[r.key]}</h2>
            <span className="text-xs text-muted-foreground">{r.role}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{r.does}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!cfg.supervised}
          aria-label={`${AGENT_LABEL[r.key]} works on its own`}
          disabled={save.busy}
          onClick={toggle}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            cfg.supervised ? 'bg-(--attn-2)/30 border-(--attn-2)/50' : 'border-primary/50 bg-primary/40',
          )}
        >
          <span className={cn('size-4.5 rounded-full bg-card shadow-sm transition-transform', cfg.supervised ? 'translate-x-0.5' : 'translate-x-5.5')} />
        </button>
      </div>

      <dl className="grid grid-cols-3 border-y text-center">
        <Stat k="Recent runs" v={runs.length} />
        <Stat k="Failed" v={failed} warn={failed > 0} />
        <Stat k="AI cost" v={cost ? usd(cost) : '—'} />
      </dl>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className={cn('inline-flex items-center gap-1.5 font-medium', cfg.supervised ? 'text-amber-700 dark:text-amber-300' : 'text-primary')}>
            {cfg.supervised ? <Eye className="size-3.5" /> : <Zap className="size-3.5" />}
            {cfg.supervised ? 'Supervised: every action waits for you' : 'Autonomous within Permissions'}
          </span>
          {last && (
            <Link to="/app/agents" search={{ run: last.id }} className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Activity className="size-3.5" /> Last run {ago(last.startedAt)}
            </Link>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {r.policies.map((p) => (
            <Link key={p} to="/app/settings" search={{ tab: 'permissions' }} className="well rounded-full px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
              {p}
            </Link>
          ))}
        </div>

        {r.usesModel ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (dirty) save.run({ supervised: cfg.supervised, instructions: notes })
            }}
          >
            <Label htmlFor={`notes-${r.key}`}>Custom instructions</Label>
            <Textarea id={`notes-${r.key}`} rows={3} maxLength={1000} placeholder={r.placeholder} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex items-center gap-2">
              <Muted className="flex-1">Added to this agent’s prompt. Safety rules always win.</Muted>
              {dirty && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setNotes(cfg.instructions)}>
                  Undo
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!dirty || save.busy}>
                <Save /> Save
              </Button>
            </div>
          </form>
        ) : (
          <Muted className="block">Runs on the route optimizer, not a model prompt, so there are no instructions to customise. Supervision still applies.</Muted>
        )}
        <ErrorText error={save.error} />
      </div>
    </Card>
  )
}

const Stat = ({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) => (
  <div className="border-r px-3 py-3 last:border-r-0">
    <dd className={cn('text-lg font-semibold tabular-nums', warn && 'text-destructive')}>{v}</dd>
    <dt className="text-[11px] text-muted-foreground">{k}</dt>
  </div>
)
