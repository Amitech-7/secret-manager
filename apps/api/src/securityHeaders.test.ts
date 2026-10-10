import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { createSession } from './auth/session'
import { addUser, harness, TEST_SOURCE, type Harness } from './testkit'

let h: Harness
let app: ReturnType<typeof createApp>
beforeAll(async () => {
  h = await harness()
  app = createApp(h.deps)
})
afterAll(async () => h.client.close())

const get = (path: string, token?: string) =>
  app.request(`/api/v1${path}`, {
    headers: { 'x-real-ip': '10.30.0.1', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })

describe('API response headers', () => {
  it('forbids caching on every kind of response', async () => {
    const userId = await addUser(h.db, 'headers.user')
    const { accessToken } = await createSession(h.db, TEST_SOURCE.JWT_SECRET, userId, h.clock.now)

    const responses = {
      health: await get('/health'),
      notFound: await get('/does-not-exist'),
      unauthorised: await get('/vault/items'),
      vaultList: await get('/vault/items', accessToken),
      me: await get('/me', accessToken),
    }
    expect(responses.health.status).toBe(200)
    expect(responses.notFound.status).toBe(404)
    expect(responses.unauthorised.status).toBe(401)
    expect(responses.vaultList.status).toBe(200)
    for (const [name, res] of Object.entries(responses)) {
      expect(res.headers.get('cache-control'), name).toBe('no-store')
    }
  })

  it('keeps the standard hardening headers', async () => {
    const res = await get('/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBeTruthy()
  })
})
