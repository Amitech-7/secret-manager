import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rateLimits } from '@sm/db'
import { buildBase } from './app'
import { hit, hmacHex, rateLimit } from './rateLimit'
import { harness, type Harness } from './testkit'

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(async () => h.client.close())

const makeApp = (group: string, limit: number, windowSec = 60) => {
  const app = buildBase(h.deps)
  app.get('/limited', rateLimit({ group, limit, windowSec }), (c) => c.json({ ok: true }))
  return app
}
const call = (app: ReturnType<typeof makeApp>, ip: string) =>
  app.request('/api/v1/limited', { headers: { 'x-real-ip': ip } })

describe('rate limiter (Postgres-backed)', () => {
  it('allows up to the limit, then answers 429 with Retry-After', async () => {
    const app = makeApp('g1', 3)
    for (let i = 0; i < 3; i++) expect((await call(app, '1.1.1.1')).status).toBe(200)
    const blocked = await call(app, '1.1.1.1')
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('counts each client and each group separately', async () => {
    const a = makeApp('g2a', 1)
    const b = makeApp('g2b', 1)
    expect((await call(a, '2.2.2.2')).status).toBe(200)
    expect((await call(a, '2.2.2.2')).status).toBe(429)
    expect((await call(a, '3.3.3.3')).status).toBe(200)
    expect((await call(b, '2.2.2.2')).status).toBe(200)
  })

  it('opens a fresh window after the old one ends', async () => {
    const app = makeApp('g3', 1, 60)
    expect((await call(app, '4.4.4.4')).status).toBe(200)
    expect((await call(app, '4.4.4.4')).status).toBe(429)
    h.clock.now = new Date(h.clock.now.getTime() + 61_000)
    expect((await call(app, '4.4.4.4')).status).toBe(200)
  })

  it('falls back to the first X-Forwarded-For address', async () => {
    const app = makeApp('g4', 1)
    const go = () =>
      app.request('/api/v1/limited', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } })
    expect((await go()).status).toBe(200)
    expect((await go()).status).toBe(429)
  })

  it('never stores raw IP addresses', async () => {
    const rows = await h.db.select().from(rateLimits)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.key).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
      expect(row.key).toMatch(/^[a-z0-9-]+:[0-9a-f]{32}$/)
    }
  })

  it('is atomic: concurrent hits never lose a count', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => hit(h.db, 'concurrent', 60, h.clock.now)),
    )
    expect(results.map((r) => r.count).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    )
  })

  it('supports a custom identity, such as a username hash', async () => {
    const app = buildBase(h.deps)
    app.get(
      '/by-name',
      rateLimit({
        group: 'login',
        limit: 1,
        windowSec: 60,
        identity: (c) => c.req.query('u') ?? '',
      }),
      (c) => c.json({}),
    )
    const go = (u: string) =>
      app.request(`/api/v1/by-name?u=${u}`, { headers: { 'x-real-ip': '5.5.5.5' } })
    expect((await go('alice')).status).toBe(200)
    expect((await go('alice')).status).toBe(429)
    expect((await go('bob')).status).toBe(200)
  })

  it('hmac keys are stable and secret-dependent', () => {
    expect(hmacHex('s'.repeat(32), 'x')).toBe(hmacHex('s'.repeat(32), 'x'))
    expect(hmacHex('s'.repeat(32), 'x')).not.toBe(hmacHex('t'.repeat(32), 'x'))
  })
})
