import { createFileRoute } from '@tanstack/react-router'

/** Server-sent events: every domain event is pushed to open dashboards (live board, traces, inbox). */
export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { ensureBooted } = await import('#/server/bootstrap')
        const { subscribe } = await import('#/server/lib/bus')
        await ensureBooted()
        const enc = new TextEncoder()
        let unsub = () => {}
        let ping: ReturnType<typeof setInterval> | undefined
        const stream = new ReadableStream({
          start(ctrl) {
            const send = (s: string) => {
              try {
                ctrl.enqueue(enc.encode(s))
              } catch {
                cleanup()
              }
            }
            const cleanup = () => {
              unsub()
              if (ping) clearInterval(ping)
            }
            send('retry: 3000\n\n')
            unsub = subscribe((ev) => send(`id: ${ev.id}\nevent: domain\ndata: ${JSON.stringify(ev)}\n\n`))
            ping = setInterval(() => send(': ping\n\n'), 20_000)
            request.signal.addEventListener('abort', () => {
              cleanup()
              try {
                ctrl.close()
              } catch {}
            })
          },
          cancel() {
            unsub()
            if (ping) clearInterval(ping)
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        })
      },
    },
  },
})
