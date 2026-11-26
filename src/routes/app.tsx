import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarRange,
  ChartNoAxesCombined,
  CircleDollarSign,
  ExternalLink,
  Inbox,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSession, getSnapshot, logout } from '#/fns'
import { ConfirmProvider } from '#/ui/confirm'
import { LiveProvider, useLive } from '#/ui/live'
import { ThemeToggle } from '#/ui/theme'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    if (!(await getSession()).owner) throw redirect({ to: '/' })
  },
  loader: () => getSnapshot(),
  component: AppLayout,
  ssr: false,
  pendingComponent: AppSkeleton,
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
  { to: '/app/agent', label: 'Agent', icon: Sparkles },
  { to: '/app/team', label: 'Agent team', icon: Bot },
  { to: '/app/agents', label: 'Agent traces', icon: Activity },
  { to: '/app/roi', label: 'ROI & simulator', icon: ChartNoAxesCombined },
  { to: '/app/settings', label: 'Settings', icon: Settings },
] as const

/** Stable keys for fixed-length placeholder lists. */
const keys = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`)

/** First load: the shell's exact shape in shimmer (same rail width, header and page frame), so nothing jumps when data lands. */
function AppSkeleton() {
  return (
    <div className="canvas flex min-h-screen flex-col md:flex-row" aria-busy="true">
      <output className="sr-only">Loading the front office…</output>
      <div className={cn(railClass, 'md:w-18 md:items-center md:px-0 rail-open:md:w-60 rail-open:md:items-stretch rail-open:md:px-3')}>
        <div className="mr-1 flex shrink-0 items-center gap-2.5 md:mr-0 md:mb-3 rail-open:md:px-0.5">
          <Skeleton className="size-9 shrink-0 rounded-xl" />
          <div className="hidden flex-1 space-y-1.5 rail-open:md:block">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-2.5 w-14" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 gap-1 overflow-hidden md:flex-none md:flex-col">
          {keys('rail', NAV.length).map((k) => (
            <div key={k} className="flex h-10 w-10 shrink-0 items-center justify-center gap-3 rail-open:md:w-full rail-open:md:justify-start rail-open:md:px-3">
              <Skeleton className="size-[18px] shrink-0 rounded-md" />
              <Skeleton className="hidden h-3 w-24 rail-open:md:block" />
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1 md:mt-auto md:flex-col md:items-stretch">
          <Skeleton className="h-10 w-10 rounded-full md:mb-1 rail-open:md:w-full" />
          <div className="hidden flex-col items-center gap-1 md:flex rail-open:flex-row rail-open:justify-between">
            {keys('foot', 3).map((k) => (
              <Skeleton key={k} className="size-10 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-6">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="ml-auto h-9 w-full rounded-xl sm:w-80" />
        </div>
        <div className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px] space-y-4">
            <Skeleton className="h-7 w-48" />
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {keys('kpi', 4).map((k) => (
                <div key={k} className="slab space-y-3 rounded-xl border p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-11 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
            <div className="slab space-y-3 rounded-xl border p-5">
              <Skeleton className="h-4 w-40" />
              {keys('row', 5).map((k) => (
                <Skeleton key={k} className="h-11 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AppLayout() {
  const initial = Route.useLoaderData()
  return (
    <LiveProvider initial={initial}>
      <Shell />
    </LiveProvider>
  )
}

const RAIL_KEY = 'rail'
/** Shared by the rail and its loading skeleton so both are the same box. */
const railClass =
  'sticky top-0 z-20 flex items-center gap-1 border-b border-(--edge) bg-(--glass) px-2 py-2 shadow-(--slab-shadow) backdrop-blur-xl md:h-screen md:shrink-0 md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-3 motion-safe:md:transition-[width] motion-safe:md:duration-200'

/** Read synchronously (the dashboard renders client-only) so the first frame already has the right width. */
const readRail = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === 'open'
  } catch {
    return false
  }
}

/** Sidebar width preference: collapsed icon rail (default) or labelled list. Kept per browser. */
function useRail() {
  const [open, setOpen] = useState(readRail)
  useEffect(() => {
    // the board's floating dock centres itself on the work area using this width
    document.documentElement.style.setProperty('--rail', open ? '15rem' : '4.5rem')
    document.documentElement.dataset.rail = open ? 'open' : 'closed'
  }, [open])
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(RAIL_KEY, o ? 'closed' : 'open')
      } catch {}
      return !o
    })
  return [open, toggle] as const
}

/** A rail item: icon-only with a tooltip when collapsed, icon plus label when open. */
function RailItem({ open, label, children }: { open: boolean; label: string; children: React.ReactElement }) {
  if (open) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function Shell() {
  const { snap, connected } = useLive()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const pending = snap?.approvals.filter((a) => a.status === 'pending').length ?? 0
  const [open, toggle] = useRail()
  const item = cn(
    'relative flex h-10 shrink-0 items-center gap-3 rounded-xl text-sm text-muted-foreground transition-[background-color,color] hover:bg-secondary hover:text-foreground',
    open ? 'md:w-full md:px-3' : 'w-10 justify-center',
    'w-10 justify-center md:justify-start',
    !open && 'md:justify-center',
  )
  return (
    <div className="canvas flex min-h-screen flex-col md:flex-row">
      <aside data-open={open} className={cn(railClass, open ? 'md:w-60 md:px-3' : 'md:w-18 md:items-center md:px-0')}>
        <div className={cn('mr-1 flex shrink-0 items-center gap-2.5 md:mr-0 md:mb-3', open && 'md:px-0.5')}>
          <div className="tile tile-solid size-9 shrink-0 rounded-full" title={snap?.company.name}>
            <Wrench size={17} />
          </div>
          {open && (
            <div className="hidden min-w-0 leading-tight md:block">
              <div className="truncate text-sm font-semibold">{snap?.company.name.split(' ')[0] ?? 'Northline'}</div>
              <div className="text-[11px] text-muted-foreground">Front office</div>
            </div>
          )}
        </div>
        <nav aria-label="Main" className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:flex-none md:flex-col md:overflow-visible">
          {NAV.map((n) => (
            <RailItem key={n.to} open={open} label={n.label}>
              <Link
                to={n.to}
                activeOptions={{ exact: 'exact' in n }}
                aria-label={n.label}
                className={cn(
                  item,
                  'data-[status=active]:bg-foreground/8 data-[status=active]:font-medium data-[status=active]:text-foreground data-[status=active]:[&>svg]:text-primary',
                )}
              >
                <n.icon size={18} className="shrink-0" />
                {open && <span className="hidden truncate md:inline">{n.label}</span>}
                {'badge' in n &&
                  pending > 0 &&
                  (open ? <span className="tile tile-attn ml-auto hidden h-5 min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums md:grid">{pending}</span> : null)}
                {'badge' in n && pending > 0 && (
                  <span className={cn('tile tile-attn absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] font-semibold tabular-nums', open && 'md:hidden')}>
                    {pending}
                  </span>
                )}
              </Link>
            </RailItem>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1 md:mt-auto md:flex-col md:items-stretch">
          <RailItem open={open} label="Open customer page">
            <a
              href="/book"
              target="_blank"
              rel="noreferrer"
              aria-label="Open customer page"
              className={cn(
                'group/cta flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.16),0_6px_18px_-8px_var(--primary)] transition-[background-color,scale] outline-none hover:bg-[color-mix(in_oklch,var(--primary),white_10%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97]',
                open ? 'w-10 md:mb-1 md:w-full md:px-4' : 'w-10 md:mb-1',
              )}
            >
              <ExternalLink size={17} className="shrink-0" />
              {open && (
                <>
                  <span className="hidden md:inline">Customer page</span>
                  <ArrowUpRight size={15} className="ml-auto hidden shrink-0 transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5 md:inline" />
                </>
              )}
            </a>
          </RailItem>
          <div className={cn('flex items-center gap-1', open ? 'md:justify-between' : 'md:flex-col')}>
            <ThemeToggle className="size-10 rounded-xl" />
            <RailItem open={open} label="Sign out">
              <button
                type="button"
                aria-label="Sign out"
                onClick={async () => {
                  await logout()
                  location.href = '/'
                }}
                className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <LogOut size={18} />
              </button>
            </RailItem>
            <RailItem open={open} label="Expand sidebar">
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
                className="hidden size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:grid"
              >
                {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              </button>
            </RailItem>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-medium">{snap?.company.name ?? 'Northline'}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-(--glass) px-2 py-0.5 text-xs text-muted-foreground shadow-[inset_0_1px_0_var(--edge)]">
              <span className={`size-1.5 rounded-full ${connected ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
              {connected ? 'Agents live' : 'Connecting'}
            </span>
          </div>
          <AskBar name={(snap?.settings.persona as { agentName?: string } | undefined)?.agentName ?? 'the agent'} />
        </header>
        <main className="min-w-0 flex-1 p-4 pb-28 md:p-6 md:pb-28">
          {snap ? (
            <div key={path} className="route-in mx-auto w-full max-w-[1600px]">
              <ConfirmProvider>
                <Outlet />
              </ConfirmProvider>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}

/** Top-bar question field: hands the question to the agent chat, which answers it on arrival. */
function AskBar({ name }: { name: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form
      aria-label={`Ask ${name}`}
      className="ml-auto w-full sm:w-80"
      onSubmit={(e) => {
        e.preventDefault()
        if (!q.trim()) return
        navigate({ to: '/app/agent', search: { q: q.trim() } })
        setQ('')
      }}
    >
      <div className="relative">
        <label htmlFor="ask" className="sr-only">
          Ask {name}
        </label>
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <Input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask ${name}: who is free at 2pm?`} className="h-9 rounded-xl pl-9" />
      </div>
    </form>
  )
}
