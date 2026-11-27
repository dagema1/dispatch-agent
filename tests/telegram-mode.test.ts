import { afterEach, describe, expect, it, vi } from 'vitest'

async function modeWith(appUrl: string, mode?: string) {
  vi.resetModules()
  vi.stubEnv('APP_URL', appUrl)
  vi.stubEnv('TELEGRAM_MODE', mode ?? '')
  return (await import('../src/server/integrations/telegram')).telegramMode()
}

describe('telegram mode', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('polls on localhost', async () => expect(await modeWith('http://localhost:3000')).toBe('polling'))
  it('uses a webhook on https', async () => expect(await modeWith('https://dispatch.example.com')).toBe('webhook'))
  it('polls on https when told to', async () => expect(await modeWith('https://dispatch.example.com', 'polling')).toBe('polling'))
})
