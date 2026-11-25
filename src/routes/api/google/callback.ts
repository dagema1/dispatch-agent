import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const { verify } = await import('#/server/lib/links')
        const issued = verify('oauth', url.searchParams.get('state') ?? '')
        if (!issued || Date.now() / 1000 - issued > 600) return new Response('invalid or expired state', { status: 400 })
        const code = url.searchParams.get('code')
        if (!code) return new Response(`Google sign-in cancelled: ${url.searchParams.get('error') ?? ''}`, { status: 400 })
        const { exchangeCode } = await import('#/server/integrations/google')
        await exchangeCode(code)
        return new Response(null, {
          status: 302,
          headers: { Location: '/app/settings?google=connected' },
        })
      },
    },
  },
})
