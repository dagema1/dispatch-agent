import { createFileRoute } from '@tanstack/react-router'

/**
 * Liveness for the container platform. It also starts the server's background work (migrations,
 * queue worker, Telegram polling, local cron), which otherwise waits for the first visitor: after a
 * deploy nobody may open the app for hours, and the technicians' bot must answer anyway.
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        try {
          await (await import('#/server/bootstrap')).ensureBooted()
          return Response.json({ ok: true })
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 503 })
        }
      },
    },
  },
})
