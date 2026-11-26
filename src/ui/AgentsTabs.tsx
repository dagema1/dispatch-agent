import { Link } from '@tanstack/react-router'
import { Activity, Bot } from 'lucide-react'

/** Agent team and Agent traces are one place ("Agents") with two views; this is the switch between them. */
export function AgentsTabs() {
  const tab =
    'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-foreground/11 data-[status=active]:font-medium data-[status=active]:text-foreground data-[status=active]:shadow-[inset_0_1px_0_var(--edge)] data-[status=active]:[&>svg]:text-primary'
  return (
    <nav aria-label="Agents" className="mb-4">
      <div className="segmented flex w-fit gap-0.5 rounded-full p-[3px]">
        <Link to="/app/team" className={tab}>
          <Bot className="size-4" /> Team
        </Link>
        <Link to="/app/agents" search={{}} className={tab}>
          <Activity className="size-4" /> Traces
        </Link>
      </div>
    </nav>
  )
}
