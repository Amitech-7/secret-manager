import { createTestDb, type TestDb } from '@sm/db/testing'
import { users, type Database } from '@sm/db'
import type { Deps } from './deps'
import { parseEnv, type Env } from './env'

export const TEST_SOURCE = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  CRON_SECRET: 'c'.repeat(40),
  RATE_LIMIT_SECRET: 'r'.repeat(40),
  ALLOWED_ORIGINS: 'https://localhost, capacitor://localhost',
}

export const testEnv = (overrides: Record<string, string> = {}): Env =>
  parseEnv({ ...TEST_SOURCE, ...overrides })

export interface Harness {
  deps: Deps
  db: Database
  client: TestDb['client']
  clock: { now: Date }
}

/** Real Postgres (PGlite) with production migrations, plus a clock the test controls. */
export async function harness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const { db, client } = await createTestDb()
  const clock = { now: new Date('2026-10-05T12:00:00Z') }
  const env = testEnv(envOverrides)
  return { deps: { getEnv: () => env, getDb: () => db, now: () => clock.now }, db, client, clock }
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

export async function addUser(
  db: Database,
  username: string,
  extra: Partial<typeof users.$inferInsert> = {},
) {
  const [row] = await db
    .insert(users)
    .values({
      username,
      authHash: bytes(32, 1),
      kdfSalt: bytes(16, 2),
      kdfParams: { alg: 'argon2id', version: 19, memoryKiB: 110592, iterations: 3, parallelism: 1 },
      wrappedVkPw: bytes(60, 3),
      wrappedVkRec: bytes(60, 4),
      recoveryAuthHash: bytes(32, 5),
      ...extra,
    })
    .returning({ id: users.id })
  return row!.id
}
