import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getSnapshot } from '#/fns'
import type { Snapshot } from '#/server/api/views'

export type DomainEvent = {
  id: number
  type: string
  payload: Record<string, unknown>
  createdAt: string
}
type Live = {
  snap: Snapshot | null
  events: DomainEvent[]
  refresh: () => Promise<void>
  connected: boolean
}
const Ctx = createContext<Live>({
  snap: null,
  events: [],
  refresh: async () => {},
  connected: false,
})

/** Snapshot of the business + a live event stream; any domain event triggers a (debounced) refresh. */
export function LiveProvider({ initial, children }: { initial: Snapshot | null; children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(initial)
  const [events, setEvents] = useState<DomainEvent[]>([])
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refresh = useCallback(async () => {
    setSnap(await getSnapshot())
  }, [])
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.addEventListener('domain', (m) => {
      const ev = JSON.parse((m as MessageEvent).data) as DomainEvent
      setEvents((xs) => [ev, ...xs].slice(0, 150))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => refresh().catch(() => {}), ev.type === 'tech.location' ? 1500 : 350)
    })
    const poll = setInterval(() => refresh().catch(() => {}), 30_000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [refresh])
  return <Ctx.Provider value={{ snap, events, refresh, connected }}>{children}</Ctx.Provider>
}

export const useLive = () => useContext(Ctx)
export function useSnap() {
  const { snap } = useContext(Ctx)
  if (!snap) throw new Error('snapshot not loaded')
  return snap
}

/** Run an async action with a busy flag and an error message. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { refresh } = useLive()
  const run = async (...a: A) => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn(...a)
      await refresh().catch(() => {})
      return r
    } catch (e) {
      setError((e as Error).message)
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error }
}
