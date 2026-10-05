import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildBase, createApp, MAX_BODY_BYTES } from './app'
import { AppError } from './errors'
import { parseJson } from './validate'
import { harness, type Harness } from './testkit'

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(async () => h.client.close())

describe('app shell', () => {
  it('health works with no environment and no database at all', async () => {
    const app = createApp({
      getEnv: () => {
        throw new Error('env must not be touched')
      },
      getDb: () => {
        throw new Error('db must not be touched')
      },
      now: () => new Date(),
    })
    const res = await app.request('/api/v1/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('returns the shared error shape for unknown routes', async () => {
    const res = await createApp(h.deps).request('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  })

  it('sends CORS headers only to allow-listed origins', async () => {
    const app = createApp(h.deps)
    const ok = await app.request('/api/v1/health', { headers: { Origin: 'capacitor://localhost' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
    const evil = await app.request('/api/v1/health', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers CORS preflight for an allowed origin', async () => {
    const res = await createApp(h.deps).request('/api/v1/items', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
  })
})

describe('error handling and validation', () => {
  const app = buildBase({
    getEnv: () => h.deps.getEnv(),
    getDb: () => h.db,
    now: () => new Date(),
  })
  const schema = z.object({ name: z.string().min(1), age: z.number().int() })
  app.post('/echo', async (c) => c.json(await parseJson(c, schema)))
  app.get('/app-error', () => {
    throw new AppError('QUOTA_EXCEEDED', 'Item limit reached')
  })
  app.get('/boom', () => {
    throw new Error('connection to postgres://user:SECRETPASSWORD@host failed')
  })
  const post = (body: string, headers: Record<string, string> = {}) =>
    app.request('/api/v1/echo', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...headers },
    })

  it('accepts valid JSON', async () => {
    const res = await post(JSON.stringify({ name: 'a', age: 3 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'a', age: 3 })
  })

  it('reports invalid fields by name without echoing values', async () => {
    const res = await post(JSON.stringify({ name: '', age: 'my-secret-value' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION')
    expect(body.error.message).toContain('name')
    expect(body.error.message).toContain('age')
    expect(JSON.stringify(body)).not.toContain('my-secret-value')
  })

  it('rejects malformed JSON', async () => {
    const res = await post('{not json')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION')
  })

  it('maps AppError codes to their documented status', async () => {
    const res = await app.request('/api/v1/app-error')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: 'QUOTA_EXCEEDED', message: 'Item limit reached' },
    })
  })

  it('hides internal errors completely, including from the logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await app.request('/api/v1/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Internal error' } })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('SECRETPASSWORD')
    log.mockRestore()
  })

  it('rejects bodies over the size limit', async () => {
    const res = await post('x'.repeat(MAX_BODY_BYTES + 10), {
      'Content-Length': String(MAX_BODY_BYTES + 10),
    })
    expect(res.status).toBe(413)
  })
})
