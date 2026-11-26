import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Bot,
  CalendarRange,
  ChartNoAxesCombined,
  CircleDollarSign,
  ExternalLink,
  FlaskConical,
  Globe,
  Inbox,
  LogOut,
  Menu,
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
import { RouteMotif } from '#/ui/RouteMotif'
import { ThemeToggle } from '#/ui/theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const s = await getSession()
    if (!s.owner) throw redirect({ to: '/' })
    if (!s.setupDone) throw redirect({ to: '/setup' })
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
  { to: '/app/agent', label: 'Agent chat', icon: Sparkles },
  { to: '/app/team', label: 'Agents', icon: Bot, also: '/app/agents' },
  { to: '/app/roi', label: 'ROI & simulator', icon: ChartNoAxesCombined },
  { to: '/app/sim', label: 'Simulators', icon: FlaskConical },
  { to: '/app/settings', label: 'Settings', icon: Settings },
] as const

/** Stable keys for fixed-length placeholder lists. */
const keys = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`)

/** First load: the shell's exact shape in shimmer (same rail width, header and page frame), so nothing jumps when data lands. */
function AppSkeleton() {
  return (
    <div className="canvas flex min-h-screen flex-col md:flex-row" aria-busy="true">
      <output className="sr-only">Loading the front office…</output>
      <div className={cn(railClass, 'max-md:hidden md:w-20 md:items-center md:px-0 rail-open:md:w-64 rail-open:md:items-stretch rail-open:md:px-3')}>
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
          <Skeleton className="h-10 w-10 rounded-2xl md:mb-2 rail-open:md:h-12 rail-open:md:w-full" />
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
  'rail-glass sticky top-0 z-20 flex md:self-start items-center gap-1 border-b border-(--edge) px-2 py-2 md:top-3 md:m-3 md:mr-0 md:h-[calc(100dvh-1.5rem)] md:shrink-0 md:flex-col md:items-stretch md:rounded-3xl md:border md:py-3 motion-safe:md:transition-[width] motion-safe:md:duration-200'

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
    document.documentElement.style.setProperty('--rail', open ? '16.75rem' : '5.75rem')
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
    'relative flex h-10 shrink-0 items-center gap-3 rounded-xl text-sm text-muted-foreground transition-[background-color,color] hover:bg-foreground/6 hover:text-foreground',
    open ? 'md:w-full md:px-3' : 'w-10 justify-center',
    'w-10 justify-center md:justify-start',
    !open && 'md:justify-center',
  )
  return (
    <div className="canvas isolate flex min-h-screen flex-col md:flex-row">
      <RouteMotif className="absolute inset-x-0 top-0 -z-10 h-56 w-full opacity-60" />
      <aside data-open={open} className={cn(railClass, 'max-md:hidden', open ? 'md:w-64 md:px-3' : 'md:w-20 md:items-center md:px-0')}>
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
                  'also' in n && path.startsWith(n.also) && 'bg-foreground/8 font-medium text-foreground [&>svg]:text-primary',
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
          <RailItem open={open} label="Customer booking page">
            <a
              href="/book"
              target="_blank"
              rel="noreferrer"
              aria-label="Open the customer booking page in a new tab"
              className={cn(
                'group/cta flex shrink-0 items-center gap-2.5 rounded-2xl text-sm outline-none transition-[background-color,scale] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] md:mb-2',
                open
                  ? 'border border-(--edge) bg-foreground/4 p-2 hover:bg-foreground/8'
                  : 'size-10 justify-center text-muted-foreground hover:bg-foreground/6 hover:text-foreground',
              )}
            >
              <span className={cn('grid shrink-0 place-items-center', open && 'tile tile-action size-8 rounded-xl')}>
                <Globe size={open ? 16 : 18} />
              </span>
              {open && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium">Customer page</span>
                    <span className="block truncate text-[11px] text-muted-foreground">Book, call, track</span>
                  </span>
                  <ArrowUpRight size={15} className="mr-1 shrink-0 text-muted-foreground transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
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
            <span className="tile tile-solid size-8 shrink-0 md:hidden" aria-hidden>
              <Wrench size={15} />
            </span>
            <span className="truncate font-medium">{snap?.company.name ?? 'Northline'}</span>
            {!connected && <output className="text-xs text-muted-foreground">Reconnecting…</output>}
          </div>
          {path !== '/app/agent' && <AskBar name={(snap?.settings.persona as { agentName?: string } | undefined)?.agentName ?? 'the agent'} />}
        </header>
        <main className="min-w-0 flex-1 p-4 pb-44 md:p-6 md:pb-28">
          {snap ? (
            <div key={path} className="route-in mx-auto w-full max-w-[1600px]">
              <ConfirmProvider>
                <Outlet />
              </ConfirmProvider>
            </div>
          ) : null}
        </main>
      </div>
      <MobileTabs pending={pending} />
    </div>
  )
}

/** Phones: the four places an owner goes most, thumb-reachable at the bottom; everything else under More. */
const PRIMARY = ['/app', '/app/inbox', '/app/approvals', '/app/money'] as const
function MobileTabs({ pending }: { pending: number }) {
  const [more, setMore] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const rest = NAV.filter((n) => !(PRIMARY as readonly string[]).includes(n.to))
  const inRest = rest.some((n) => path.startsWith(n.to) || ('also' in n && path.startsWith(n.also)))
  const tab = 'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[11px] text-muted-foreground transition-colors'
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t border-(--edge) bg-(--glass-strong) px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden"
    >
      {NAV.filter((n) => (PRIMARY as readonly string[]).includes(n.to)).map((n) => (
        <Link
          key={n.to}
          to={n.to}
          activeOptions={{ exact: 'exact' in n }}
          className={cn(
            tab,
            'data-[status=active]:bg-foreground/8 data-[status=active]:font-medium data-[status=active]:text-foreground data-[status=active]:[&>svg]:text-primary',
          )}
        >
          <n.icon size={20} />
          <span className="truncate">{n.label.split(' ')[0]}</span>
          {'badge' in n && pending > 0 && (
            <span className="tile tile-attn absolute top-0.5 right-[calc(50%-1.25rem)] h-4 min-w-4 rounded-full px-1 text-[10px] font-semibold tabular-nums">{pending}</span>
          )}
        </Link>
      ))}
      <Sheet open={more} onOpenChange={setMore}>
        <SheetTrigger asChild>
          <button type="button" className={cn(tab, inRest && 'bg-foreground/8 font-medium text-foreground')}>
            <Menu size={20} className={cn(inRest && 'text-primary')} />
            <span>More</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="gap-0 rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <ul className="grid gap-1 px-3">
            {rest.map((n) => (
              <li key={n.to}>
                <Link
                  to={n.to}
                  onClick={() => setMore(false)}
                  className="flex h-12 items-center gap-3 rounded-2xl px-3 text-sm text-muted-foreground data-[status=active]:bg-foreground/8 data-[status=active]:font-medium data-[status=active]:text-foreground"
                >
                  <n.icon size={18} /> {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2 border-t border-(--edge) px-3 pt-3">
            <Button asChild className="flex-1">
              <a href="/book" target="_blank" rel="noreferrer">
                <ExternalLink /> Customer page
              </a>
            </Button>
            <ThemeToggle className="size-9 rounded-full" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={async () => {
                await logout()
                location.href = '/'
              }}
            >
              <LogOut />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
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
