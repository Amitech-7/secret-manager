import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema'

/** Driver-neutral handle: node-postgres in production, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    // Serverless functions: keep the pool tiny and let the Neon pooler do the multiplexing.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema }) as unknown as Database
}

/** Runs raw SQL and returns the rows, whichever driver backs the database. */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[]
  return Array.isArray(result) ? result : (result.rows ?? [])
}
