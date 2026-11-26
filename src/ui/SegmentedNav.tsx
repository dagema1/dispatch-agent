import { Link, type LinkProps } from '@tanstack/react-router'
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type SegmentItem = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Small grey note, wide screens only. */
  meta?: string
  /** Always-visible count; turns blue on the active tab. */
  count?: number
  /** Route tab. Without it the item is a button and `onSelect` handles the switch. */
  link?: LinkProps
}

type Pill = { x: number; w: number }
/** Last pill position per persisted nav, so tabs that are separate routes (and remount) still slide. */
const lastPill = new Map<string, Pill>()

/**
 * Page tabs as a segmented pill whose active highlight slides to the chosen tab instead of
 * jumping. Pair with <TabPanel> so the content enters from the side the user moved toward.
 */
export function SegmentedNav({
  items,
  active,
  label,
  onSelect,
  className,
  persist,
}: {
  items: SegmentItem[]
  active: string
  label: string
  onSelect?: (key: string) => void
  className?: string
  /** Remember the pill across remounts (tabs that are separate routes). */
  persist?: boolean
}) {
  const track = useRef<HTMLUListElement>(null)
  const refs = useRef(new Map<string, HTMLElement>())
  // A persisted nav (route tabs that remount) starts where the pill last was, then slides.
  const [start] = useState(() => (persist ? lastPill.get(label) : undefined))
  const [pill, setPill] = useState<Pill | null>(start ?? null)
  const [ready, setReady] = useState(false)
  const placed = useRef(false)

  useLayoutEffect(() => {
    const mounting = !placed.current
    // When the route changes, the outgoing instance sees the new tab first; it must not record
    // that, or the incoming one would start at the end. Only a mount or a resize records.
    const measure = (remember: boolean) => {
      const el = refs.current.get(active)
      const t = track.current
      if (!el || !t) return
      const p = { x: el.getBoundingClientRect().left - t.getBoundingClientRect().left + t.scrollLeft, w: el.offsetWidth }
      if (remember && persist) lastPill.set(label, p)
      setPill(p)
    }
    let r1 = 0
    let r2 = 0
    // ResizeObserver also reports once on observe; skip that one, placement is explicit
    let seen = false
    const ro = new ResizeObserver(() => {
      if (seen) measure(true)
      seen = true
    })
    if (track.current) ro.observe(track.current)
    if (mounting && start) {
      r1 = requestAnimationFrame(() => {
        setReady(true)
        r2 = requestAnimationFrame(() => {
          placed.current = true
          measure(true)
        })
      })
    } else {
      measure(mounting)
      r1 = requestAnimationFrame(() => {
        placed.current = true
        setReady(true)
      })
    }
    refs.current.get(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
      ro.disconnect()
    }
  }, [active, label, persist, start])

  return (
    <nav aria-label={label} className={className}>
      <ul ref={track} className="segmented no-scrollbar relative flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full p-[3px]">
        {pill && (
          <li
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-[3px] bottom-[3px] left-0 rounded-full bg-foreground/11 shadow-[inset_0_1px_0_var(--edge)]',
              ready && 'motion-safe:transition-[transform,width] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]',
            )}
            style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
          />
        )}
        {items.map((it) => {
          const on = it.key === active
          const ref = (el: HTMLElement | null) => {
            if (el) refs.current.set(it.key, el)
            else refs.current.delete(it.key)
          }
          const cls = cn(
            'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
            it.count !== undefined && 'max-sm:gap-1.5 max-sm:px-2.5',
            on ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )
          const body = (
            <>
              <it.icon className={cn('size-4 shrink-0 transition-colors duration-200', on && 'text-primary', it.count !== undefined && 'max-sm:hidden')} />
              <span>{it.label}</span>
              {it.meta && <span className="rounded-full bg-foreground/8 px-1.5 text-[11px] text-muted-foreground tabular-nums max-xl:hidden">{it.meta}</span>}
              {it.count !== undefined && (
                <span
                  className={cn(
                    'grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums transition-colors duration-200',
                    on ? 'bg-primary text-primary-foreground' : 'bg-foreground/8 text-muted-foreground',
                  )}
                >
                  {it.count}
                </span>
              )}
            </>
          )
          return (
            <li key={it.key} className="relative shrink-0">
              {it.link ? (
                <Link {...it.link} replace ref={ref} aria-current={on ? 'page' : undefined} className={cls}>
                  {body}
                </Link>
              ) : (
                <button type="button" ref={ref} aria-pressed={on} onClick={() => onSelect?.(it.key)} className={cls}>
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Tab content that slides in from the direction of travel (right when moving right, left when moving back). */
export function TabPanel({ order, active, children }: { order: readonly string[]; active: string; children: React.ReactNode }) {
  const prev = useRef(active)
  const dir = order.indexOf(active) >= order.indexOf(prev.current) ? 'next' : 'prev'
  useLayoutEffect(() => {
    prev.current = active
  }, [active])
  return (
    <div key={active} data-dir={dir} className="tab-in min-w-0">
      {children}
    </div>
  )
}
