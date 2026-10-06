import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv, Deps } from './deps'
import { errorBody, handleError } from './errors'
import { rateLimit } from './rateLimit'
import { auth } from './routes/auth'
import { cron } from './routes/cron'
import { me } from './routes/me'

export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Middleware, error handling and the 404 shape. Feature routers are mounted on top of this. */
export function buildBase(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api/v1')

  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.use('*', secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        // Same-origin web needs no CORS. Only the Capacitor app and listed origins get headers.
        try {
          return deps.getEnv().ALLOWED_ORIGINS.includes(origin) ? origin : undefined
        } catch {
          return undefined
        }
      },
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  )
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(errorBody('VALIDATION', 'Request body too large'), 413),
    }),
  )

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Not found'), 404))
  app.onError(handleError)
  return app
}

export function createApp(deps: Deps) {
  const app = buildBase(deps)

  // Needs no database and no environment, so it stays up when everything else is broken.
  app.get('/health', (c) => c.json({ status: 'ok' as const }))

  app.use('/cron/*', rateLimit({ group: 'cron', limit: 30, windowSec: 60 }))
  app.route('/cron', cron)
  app.route('/auth', auth)
  app.route('/me', me)

  return app
}
