import { createFileRoute } from '@tanstack/react-router'
import { MessagesSquare, Wrench } from 'lucide-react'
import { PageTitle } from '#/ui/bits'
import { FieldSim } from '#/ui/FieldSim'
import { MessageSim } from '#/ui/MessageSim'
import { SegmentedNav, TabPanel } from '#/ui/SegmentedNav'

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
    <div className="mx-auto max-w-6xl">
      <PageTitle title={tab === 'field' ? 'Field simulator' : 'Test inbox'} sub={META[tab].sub} />
      <SegmentedNav
        label="Simulators"
        className="mb-4"
        active={tab}
        items={TABS.map((t) => ({ key: t, label: META[t].label, icon: META[t].icon, link: { to: '/app/sim', search: { tab: t } } }))}
      />
      <TabPanel order={TABS} active={tab}>
        {tab === 'field' ? <FieldSim /> : <MessageSim />}
      </TabPanel>
    </div>
  )
}
