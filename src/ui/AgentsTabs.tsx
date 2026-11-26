import { useRouterState } from '@tanstack/react-router'
import { Activity, Bot } from 'lucide-react'
import { SegmentedNav } from '#/ui/SegmentedNav'

/** Agent team and Agent traces are one place ("Agents") with two views; this is the switch between them. */
export function AgentsTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <SegmentedNav
      label="Agents"
      persist
      className="mb-4"
      active={path.startsWith('/app/team') ? 'team' : 'traces'}
      items={[
        { key: 'team', label: 'Team', icon: Bot, link: { to: '/app/team' } },
        { key: 'traces', label: 'Traces', icon: Activity, link: { to: '/app/agents', search: {} } },
      ]}
    />
  )
}
