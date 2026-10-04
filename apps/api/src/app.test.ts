import { describe, expect, it } from 'vitest'
import app from './app'

describe('api', () => {
  it('GET /api/v1/health returns ok with security headers', async () => {
    const res = await app.request('/api/v1/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('unknown routes return the shared error shape', async () => {
    const res = await app.request('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  })
})
