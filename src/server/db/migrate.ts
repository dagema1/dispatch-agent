import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, getPool } from './index'

export async function runMigrations() {
  await migrate(db, { migrationsFolder: './drizzle' })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('migrations applied')
      return getPool().end()
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
