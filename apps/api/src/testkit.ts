import { createTestDb, type TestDb } from '@sm/db/testing'
import { users, type Database } from '@sm/db'
import type { Deps } from './deps'
import { parseEnv, type Env } from './env'

export const TEST_SOURCE = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  CRON_SECRET: 'c'.repeat(40),
  RATE_LIMIT_SECRET: 'r'.repeat(40),
  ALLOWED_ORIGINS: 'https://localhost, capacitor://localhost',
  JWT_SECRET: 'j'.repeat(40),
  FAKE_SALT_SECRET: 'f'.repeat(40),
}

export const testEnv = (overrides: Record<string, string> = {}): Env =>
  parseEnv({ ...TEST_SOURCE, ...overrides })

export interface Harness {
  deps: Deps
  db: Database
  client: TestDb['client']
  clock: { now: Date }
  /** What the fake captcha answers. Flip to false to simulate a failed challenge. */
  captcha: { passes: boolean }
}

/** Real Postgres (PGlite) with production migrations, plus a clock the test controls. */
export async function harness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const { db, client } = await createTestDb()
  const clock = { now: new Date() }
  const captcha = { passes: true }
  const env = testEnv(envOverrides)
  return {
    deps: {
      getEnv: () => env,
      getDb: () => db,
      now: () => clock.now,
      verifyTurnstile: async () => captcha.passes,
    },
    db,
    client,
    clock,
    captcha,
  }
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
