import { defineConfig } from 'vitest/config'

// Tests run on the demo company's clock whatever .env says (dotenv never overrides a set variable).
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', env: { COMPANY_TZ: 'America/Denver' } } })
