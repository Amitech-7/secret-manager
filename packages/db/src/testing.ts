import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import type { Database } from './client'
import * as schema from './schema'

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

export interface TestDb {
  db: Database
  client: PGlite
}

/** A real, in-process Postgres (WASM) with the production migrations applied. Tests only. */
export async function createTestDb(options: { beforeMigrate?: string[] } = {}): Promise<TestDb> {
  const client = new PGlite()
  for (const statement of options.beforeMigrate ?? []) await client.exec(statement)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return { db: db as unknown as Database, client }
}
