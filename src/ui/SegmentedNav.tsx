import { Link, type LinkProps } from '@tanstack/react-router'
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type SegmentItem = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  meta?: string
  link: LinkProps
}

/**
 * Page tabs as a segmented pill whose active highlight slides to the chosen tab instead of
 * jumping. Pair with <TabPanel> so the content enters from the side the user moved toward.
 */
export function SegmentedNav({ items, active, label }: { items: SegmentItem[]; active: string; label: string }) {
  const track = useRef<HTMLUListElement>(null)
  const refs = useRef(new Map<string, HTMLAnchorElement>())
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(active)
      const t = track.current
      if (el && t) setPill({ x: el.getBoundingClientRect().left - t.getBoundingClientRect().left + t.scrollLeft, w: el.offsetWidth })
    }
    measure()
    refs.current.get(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    // first paint places the pill without a slide; later changes animate
    const t = requestAnimationFrame(() => setReady(true))
    const ro = new ResizeObserver(measure)
    if (track.current) ro.observe(track.current)
    return () => {
      cancelAnimationFrame(t)
      ro.disconnect()
    }
  }, [active])

  return (
    <nav aria-label={label}>
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
          return (
            <li key={it.key} className="relative shrink-0">
              <Link
                {...it.link}
                replace
                ref={(el) => {
                  if (el) refs.current.set(it.key, el)
                  else refs.current.delete(it.key)
                }}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <it.icon className={cn('size-4 shrink-0 transition-colors duration-200', on && 'text-primary')} />
                <span>{it.label}</span>
                {it.meta && <span className="rounded-full bg-foreground/8 px-1.5 text-[11px] text-muted-foreground tabular-nums max-xl:hidden">{it.meta}</span>}
              </Link>
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
