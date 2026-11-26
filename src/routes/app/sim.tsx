import { createFileRoute, Link } from '@tanstack/react-router'
import { MessagesSquare, Wrench } from 'lucide-react'
import { PageTitle } from '#/ui/bits'
import { FieldSim } from '#/ui/FieldSim'
import { MessageSim } from '#/ui/MessageSim'
import { cn } from '@/lib/utils'

const TABS = ['field', 'messages'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/app/sim')({
  component: Simulators,
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TABS.includes(s.tab as Tab) ? { tab: s.tab as Tab } : {}),
})

const META: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }>; sub: string }> = {
  field: { label: 'Technicians', icon: Wrench, sub: 'Play a technician: accept visits, drive, arrive, add notes and close jobs. Same actions as the Telegram app.' },
  messages: { label: 'Email & texts', icon: MessagesSquare, sub: 'The customer’s side of every email and text. Write as a customer to see how the agents answer.' },
}

/** Demo tools: the field and the customer's phone, without phones. */
function Simulators() {
  const tab = Route.useSearch().tab ?? 'field'
  return (
    <div>
      <nav aria-label="Simulators" className="mb-4">
        <div className="segmented flex w-fit gap-0.5 rounded-full p-[3px]">
          {TABS.map((t) => {
            const m = META[t]
            const on = t === tab
            return (
              <Link
                key={t}
                to="/app/sim"
                search={{ tab: t }}
                replace
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'bg-foreground/11 font-medium text-foreground shadow-[inset_0_1px_0_var(--edge)]' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <m.icon className={cn('size-4', on && 'text-primary')} /> {m.label}
              </Link>
            )
          })}
        </div>
      </nav>
      <PageTitle title={tab === 'field' ? 'Field simulator' : 'Test inbox'} sub={META[tab].sub} />
      <div key={tab} className="route-in">
        {tab === 'field' ? <FieldSim /> : <MessageSim />}
      </div>
    </div>
  )
}
