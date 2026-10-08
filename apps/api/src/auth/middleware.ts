import { and, eq, isNull, sessions, sql } from '@sm/db'
import type { MiddlewareHandler } from 'hono'
import type { AuthedEnv } from '../deps'
import { AppError } from '../errors'
import { requireSecret } from './secrets'
import { verifyAccessToken } from './tokens'

/**
 * Verifies the bearer token, then checks the session is still alive. The database check is what
 * makes logout and refresh-reuse revocation take effect immediately instead of after 15 minutes.
 */
export const requireAuth: MiddlewareHandler<AuthedEnv> = async (c, next) => {
  const deps = c.get('deps')
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new AppError('UNAUTHENTICATED', 'Missing token')

  const now = deps.now()
  const claims = verifyAccessToken(
    requireSecret(deps.getEnv().JWT_SECRET, 'JWT_SECRET'),
    token,
    Math.floor(now.getTime() / 1000),
  )

  const alive = await deps
    .getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, claims.sid),
        eq(sessions.userId, claims.sub),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > ${now}`,
      ),
    )
    .limit(1)
  if (alive.length === 0) throw new AppError('UNAUTHENTICATED', 'Session ended')

  c.set('userId', claims.sub)
  c.set('sessionId', claims.sid)
  await next()
}
