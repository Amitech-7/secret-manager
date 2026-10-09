import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, rateLimits, sessions, users, vaultItems } from '@sm/db'
import { createApp } from './app'
import { runMaintenance } from './maintenance'
import { addUser, harness, type Harness } from './testkit'

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(async () => h.client.close())

const daysAgo = (n: number) => new Date(h.clock.now.getTime() - n * 86_400_000)
const hash = (fill: number) => new Uint8Array(32).fill(fill)

describe('maintenance', () => {
  it('treats starter reference items as empty, but keeps anyone with a credential or card', async () => {
    const seedOnly = await addUser(h.db, 'seed.only', {
      createdAt: daysAgo(300),
      lastLoginAt: daysAgo(200),
      itemCount: 12,
    })
    const withCard = await addUser(h.db, 'seed.and.card', {
      createdAt: daysAgo(300),
      lastLoginAt: daysAgo(200),
      itemCount: 13,
    })
    const row = (userId: string, type: string) => ({
      id: crypto.randomUUID(),
      userId,
      type,
      ciphertext: new Uint8Array(40),
    })
    await h.db
      .insert(vaultItems)
      .values([
        row(seedOnly, 'member'),
        row(seedOnly, 'bank'),
        row(seedOnly, 'account'),
        row(seedOnly, 'account_type'),
        row(withCard, 'member'),
        row(withCard, 'card'),
      ])

    const result = await runMaintenance(h.db, h.clock.now, 512)
    expect(result.inactiveUsersDeleted).toBeGreaterThanOrEqual(1)
    const names = (await h.db.select({ n: users.username }).from(users)).map((r) => r.n)
    expect(names).not.toContain('seed.only')
    expect(names).toContain('seed.and.card')
    // Its reference items went with it (cascade); the other user's two rows stay.
    expect(
      (await h.db.select().from(vaultItems).where(eq(vaultItems.userId, seedOnly))).length,
    ).toBe(0)
    expect(
      (await h.db.select().from(vaultItems).where(eq(vaultItems.userId, withCard))).length,
    ).toBe(2)

    // Tests share one database, so leave it as we found it.
    await h.db.delete(users).where(eq(users.id, withCard))
  })

  it('purges only what it should', async () => {
    const stale = await addUser(h.db, 'stale.empty', {
      createdAt: daysAgo(200),
      lastLoginAt: daysAgo(120),
    })
    const neverLoggedIn = await addUser(h.db, 'never.login', {
      createdAt: daysAgo(100),
    })
    const recent = await addUser(h.db, 'recent.empty', {
      createdAt: daysAgo(100),
      lastLoginAt: daysAgo(10),
    })
    const hasData = await addUser(h.db, 'old.with.data', {
      createdAt: daysAgo(400),
      lastLoginAt: daysAgo(300),
      itemCount: 5,
    })
    await h.db.insert(vaultItems).values({
      id: crypto.randomUUID(),
      userId: hasData,
      type: 'credential',
      ciphertext: new Uint8Array(40),
    })

    await h.db.insert(sessions).values([
      { userId: recent, refreshHash: hash(1), expiresAt: daysAgo(30) }, // long expired
      { userId: recent, refreshHash: hash(2), expiresAt: daysAgo(-5) }, // still valid
      {
        userId: recent,
        refreshHash: hash(3),
        expiresAt: daysAgo(-5),
        revokedAt: daysAgo(20),
      }, // revoked long ago
      { userId: recent, refreshHash: hash(4), expiresAt: daysAgo(3) }, // expired recently, kept for a week
    ])
    await h.db.insert(rateLimits).values([
      { key: 'old', windowStart: daysAgo(3), count: 4 },
      { key: 'fresh', windowStart: daysAgo(0), count: 1 },
    ])

    const result = await runMaintenance(h.db, h.clock.now, 512)
    expect(result.sessionsDeleted).toBe(2)
    expect(result.rateLimitsDeleted).toBe(1)
    expect(result.inactiveUsersDeleted).toBe(2)

    const names = (await h.db.select({ n: users.username }).from(users)).map((r) => r.n).sort()
    expect(names).toEqual(['old.with.data', 'recent.empty'])
    expect(stale).not.toBe(neverLoggedIn)
    expect((await h.db.select().from(sessions)).length).toBe(2)
    expect((await h.db.select().from(rateLimits)).map((r) => r.key)).toEqual(['fresh'])
    expect((await h.db.select().from(vaultItems)).length).toBe(1)
  })

  it('is idempotent', async () => {
    const again = await runMaintenance(h.db, h.clock.now, 512)
    expect(again.sessionsDeleted + again.rateLimitsDeleted + again.inactiveUsersDeleted).toBe(0)
  })

  it('reports database size and escalates the level against the limit', async () => {
    const size = (await runMaintenance(h.db, h.clock.now, 512)).dbSizeMb
    expect(size).toBeGreaterThan(0)
    expect((await runMaintenance(h.db, h.clock.now, 100_000)).level).toBe('ok')
    expect((await runMaintenance(h.db, h.clock.now, Math.ceil(size / 0.8))).level).toBe('warn')
    expect(
      (await runMaintenance(h.db, h.clock.now, Math.max(1, Math.floor(size / 0.95)))).level,
    ).toBe('critical')
  })
})

describe('GET /cron/maintenance', () => {
  const app = () => createApp(h.deps)
  const secret = 'c'.repeat(40)

  it('rejects missing, wrong and malformed credentials', async () => {
    for (const headers of [
      {},
      { Authorization: 'Bearer wrong' },
      { Authorization: secret },
      { Authorization: `bearer ${secret}` },
    ]) {
      const res = await app().request('/api/v1/cron/maintenance', { headers })
      expect(res.status).toBe(401)
    }
  })

  it('runs with the correct secret and warns in the logs when the DB is nearly full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const full = await harness({ DB_SIZE_LIMIT_MB: '1' })
    const res = await createApp(full.deps).request('/api/v1/cron/maintenance', {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ limitMb: 1 })
    expect(warn).toHaveBeenCalled()
    await full.client.close()
    warn.mockRestore()
    const ok = await app().request('/api/v1/cron/maintenance', {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(ok.status).toBe(200)
  })

  it('is rate limited', async () => {
    const limited = await harness()
    const call = () =>
      createApp(limited.deps).request('/api/v1/cron/maintenance', {
        headers: { 'x-real-ip': '8.8.8.8' },
      })
    let last = 0
    for (let i = 0; i < 31; i++) last = (await call()).status
    expect(last).toBe(429)
    await limited.client.close()
  })
})
