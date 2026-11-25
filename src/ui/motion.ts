import { useRef } from 'react'

const FRESH_MS = 2000

/**
 * Ids that appeared after the component first rendered. Items already on screen at mount stay
 * still (no page-load choreography); only things the live feed adds get the arrival animation.
 * An id stays "fresh" for 2 s, so unrelated re-renders don't cut its animation short.
 */
export function useArrivals(ids: Array<string | number>): (id: string | number) => boolean {
  const seen = useRef<Map<string | number, number> | null>(null)
  if (seen.current === null) seen.current = new Map(ids.map((id) => [id, 0]))
  const map = seen.current
  const now = Date.now()
  for (const id of ids) if (!map.has(id)) map.set(id, now)
  return (id) => {
    const t = map.get(id)
    return !!t && now - t < FRESH_MS
  }
}

/** Run a DOM change inside a view transition when supported and motion is allowed. */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  try {
    // a skipped transition rejects these promises; the DOM update still happens
    const t = doc.startViewTransition(update) as { finished?: Promise<unknown>; ready?: Promise<unknown> } | undefined
    t?.finished?.catch(() => {})
    t?.ready?.catch(() => {})
  } catch {
    update()
  }
}
