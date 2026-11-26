import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../lib/env'
import * as schema from './schema'

export type Db = NodePgDatabase<typeof schema>

const g = globalThis as unknown as { __db?: Db; __pool?: pg.Pool }

export function getPool(): pg.Pool {
  if (!g.__pool) {
    g.__pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 })
  }
  return g.__pool
}

g.__db ??= drizzle(getPool(), { schema })
export const db: Db = g.__db
export { schema }
