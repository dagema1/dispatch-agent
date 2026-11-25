import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/google/start')({
  server: {
    handlers: {
      GET: async () => {
        const { googleAuthUrl } = await import('#/server/integrations/google')
        const { sign } = await import('#/server/lib/links')
        const state = sign('oauth', Math.floor(Date.now() / 1000))
        return new Response(null, {
          status: 302,
          headers: { Location: googleAuthUrl(state) },
        })
      },
    },
  },
})
