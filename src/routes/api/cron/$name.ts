import { createFileRoute } from '@tanstack/react-router'

/**
 * Cloud Scheduler target: POST /api/cron/{tick|morning|weather}
 * Authorised with `Authorization: Bearer $CRON_SECRET` (or an OIDC-authenticated scheduler in front).
 */
export const Route = createFileRoute('/api/cron/$name')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { env } = await import('#/server/lib/env')
        const { timingSafeEqual } = await import('node:crypto')
        const got = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')
        const want = Buffer.from(env.CRON_SECRET)
        if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response('unauthorized', { status: 401 })
        if (!['tick', 'morning', 'weather'].includes(params.name)) return new Response('not found', { status: 404 })
        const { runCron } = await import('#/server/bootstrap')
        const out = await runCron(params.name as 'tick' | 'morning' | 'weather')
        return Response.json({ ok: true, name: params.name, out })
      },
    },
  },
})
