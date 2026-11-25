import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { Bot, CalendarRange, ChartNoAxesCombined, CircleDollarSign, Inbox, MessagesSquare, Settings, ShieldCheck, Wrench } from 'lucide-react'
import { getSnapshot } from '#/fns'
import { LiveProvider, useLive } from '#/ui/live'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '#/ui/theme'

export const Route = createFileRoute('/app')({
  loader: () => getSnapshot(),
  component: AppLayout,
  ssr: false,
  pendingComponent: () => <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading the front office…</div>,
})

const NAV = [
  { to: '/app', label: 'Dispatch board', icon: CalendarRange, exact: true },
  { to: '/app/inbox', label: 'Inbox & calls', icon: Inbox },
  {
    to: '/app/approvals',
    label: 'Approvals',
    icon: ShieldCheck,
    badge: 'approvals',
  },
  { to: '/app/money', label: 'Quotes & invoices', icon: CircleDollarSign },
  { to: '/app/agents', label: 'Agent traces', icon: Bot },
  { to: '/app/roi', label: 'ROI & simulator', icon: ChartNoAxesCombined },
  { to: '/app/copilot', label: 'Ops copilot', icon: MessagesSquare },
  { to: '/app/settings', label: 'Settings', icon: Settings },
] as const

function AppLayout() {
  const initial = Route.useLoaderData()
  return (
    <LiveProvider initial={initial}>
      <Shell />
    </LiveProvider>
  )
}

function Shell() {
  const { snap, connected } = useLive()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const pending = snap?.approvals.filter((a) => a.status === 'pending').length ?? 0
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="glass z-10 border-b bg-card md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Wrench size={16} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-semibold">{snap?.company.name ?? 'Northline'}</div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} /> AI front office {connected ? 'live' : 'connecting'}
            </div>
          </div>
          <ThemeToggle className="shrink-0" />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: 'exact' in n }}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-accent-foreground"
            >
              <n.icon size={16} />
              <span>{n.label}</span>
              {'badge' in n && pending > 0 && <Badge className="ml-auto bg-amber-500 text-white">{pending}</Badge>}
            </Link>
          ))}
        </nav>
        <div className="hidden px-4 pt-4 md:block">
          <Button variant="outline" className="w-full" asChild>
            <a href="/book" target="_blank" rel="noreferrer">
              Open customer page ↗
            </a>
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        {snap ? (
          <div key={path} className="route-in">
            <Outlet />
          </div>
        ) : null}
      </main>
    </div>
  )
}
