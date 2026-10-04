import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { ApiError } from '@sm/shared'

export const app = new Hono().basePath('/api/v1')

app.use('*', secureHeaders())

app.get('/health', (c) => c.json({ status: 'ok' as const }))

app.notFound((c) => {
  const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Not found' } }
  return c.json(body, 404)
})

// Never leak internals to the client.
app.onError((err, c) => {
  console.error('Unhandled error:', err.name)
  const body: ApiError = { error: { code: 'INTERNAL', message: 'Internal error' } }
  return c.json(body, 500)
})

export default app
