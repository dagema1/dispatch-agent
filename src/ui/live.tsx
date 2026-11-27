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

type Wire = { t: 'event'; ev: DomainEvent } | { t: 'status'; connected: boolean } | { t: 'hello' }

/**
 * One server stream for all open dashboard tabs. Browsers allow about six connections per host
 * over HTTP/1.1, and every tab holding its own EventSource used to starve page loads once a few
 * tabs were open. One tab (the holder of a Web Lock) owns the EventSource and relays events to
 * the others over a BroadcastChannel; when it closes, the lock passes to another tab. The leader
 * sends a heartbeat; a tab that hears nothing for a while (the leader was frozen in the background,
 * or is an old copy of the page) opens its own stream rather than going dark.
 */
function shareEvents(onEvent: (ev: DomainEvent) => void, onStatus: (c: boolean) => void): () => void {
  const solo = (): (() => void) => {
    const es = new EventSource('/api/events')
    es.onopen = () => onStatus(true)
    es.onerror = () => onStatus(false)
    es.addEventListener('domain', (m) => onEvent(JSON.parse((m as MessageEvent).data) as DomainEvent))
    return () => es.close()
  }
  if (typeof BroadcastChannel === 'undefined' || !navigator.locks) return solo()

  const ch = new BroadcastChannel('dispatch-events')
  let leader = false
  let lastStatus = false
  let closeStream: (() => void) | null = null
  let disposed = false
  let lastHeard = 0
  let own: (() => void) | null = null
  // created up front so unmounting can always hand the lock back, even if it is granted a moment later
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  const status = (c: boolean) => {
    lastStatus = c
    onStatus(c)
    if (leader) ch.postMessage({ t: 'status', connected: c } satisfies Wire)
  }
  ch.onmessage = (m: MessageEvent<Wire>) => {
    const w = m.data
    if (w.t !== 'hello') lastHeard = Date.now()
    if (w.t === 'event' && !leader) onEvent(w.ev)
    else if (w.t === 'status' && !leader) onStatus(w.connected)
    else if (w.t === 'hello' && leader) ch.postMessage({ t: 'status', connected: lastStatus } satisfies Wire)
  }
  const ac = new AbortController()
  navigator.locks
    .request('dispatch-events', { signal: ac.signal }, () => {
      // granted after this provider was already gone: give it straight back
      if (disposed) return
      leader = true
      own?.()
      own = null
      const es = new EventSource('/api/events')
      es.onopen = () => status(true)
      es.onerror = () => status(false)
      es.addEventListener('domain', (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as DomainEvent
        onEvent(ev)
        ch.postMessage({ t: 'event', ev } satisfies Wire)
      })
      closeStream = () => es.close()
      // hold the lock until this tab's provider unmounts
      return held
    })
    .catch(() => {})
  ch.postMessage({ t: 'hello' } satisfies Wire)
  const started = Date.now()
  const beat = setInterval(() => {
    if (leader) ch.postMessage({ t: 'status', connected: lastStatus } satisfies Wire)
    else if (!own && Date.now() - Math.max(lastHeard, started) > 8000) own = solo()
  }, 3000)
  return () => {
    disposed = true
    clearInterval(beat)
    own?.()
    ac.abort() // a tab still waiting for the lock must not take it after it is gone
    closeStream?.()
    release()
    ch.close()
  }
}

/** Snapshot of the business + a live event stream; any domain event triggers a (debounced) refresh. */
export function LiveProvider({ initial, children }: { initial: Snapshot | null; children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(initial)
  const [events, setEvents] = useState<DomainEvent[]>([])
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refresh = useCallback(async () => {
    setSnap(await getSnapshot())
  }, [])
  // a newer snapshot from the route loader (e.g. after setup reloads the demo) replaces the old one
  useEffect(() => {
    if (initial) setSnap(initial)
  }, [initial])
  useEffect(() => {
    const onEvent = (ev: DomainEvent) => {
      setEvents((xs) => [ev, ...xs].slice(0, 150))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => refresh().catch(() => {}), ev.type === 'tech.location' ? 1500 : 350)
    }
    const stop = shareEvents(onEvent, setConnected)
    const poll = setInterval(() => refresh().catch(() => {}), 30_000)
    return () => {
      stop()
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
