import { handleInbound } from '../src/server/agent/front-desk'
import { getPool } from '../src/server/db'

const r = await handleInbound({
  channel: 'web',
  text: process.argv[2] ?? "Our furnace stopped working and it's freezing in here. We have a newborn. Please help!",
  customer: { email: 'maria.alvarez@example.com' },
})
console.log(JSON.stringify(r, null, 2))
await getPool().end()
process.exit(0)
