import { createFileRoute } from '@tanstack/react-router'

/** Telegram webhook (deployed on https). Checks Telegram's secret header, acknowledges at once, handles the update after. */
export const Route = createFileRoute('/api/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const tg = await import('#/server/integrations/telegram')
        if (!tg.isTelegramWebhookCall(request.headers.get('x-telegram-bot-api-secret-token'))) return new Response('forbidden', { status: 403 })
        const update = (await request.json().catch(() => null)) as import('#/server/integrations/telegram').TgUpdate | null
        if (!update) return new Response('bad request', { status: 400 })
        await (await import('#/server/bootstrap')).ensureBooted()
        tg.acceptWebhookUpdate(update)
        return new Response('ok')
      },
    },
  },
})
