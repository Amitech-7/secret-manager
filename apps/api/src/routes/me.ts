import { eq, users } from '@sm/db'
import { LIMITS } from '@sm/shared'
import { Hono } from 'hono'
import { requireAuth, type AuthVars } from '../auth/middleware'
import { b64u } from '../auth/tokens'
import type { AppEnv } from '../deps'
import { AppError } from '../errors'
import { rateLimit } from '../rateLimit'

export const me = new Hono<AppEnv & { Variables: AuthVars }>()

me.use('*', rateLimit({ group: 'me', limit: 60, windowSec: 60 }), requireAuth)

me.get('/', async (c) => {
  const [user] = await c
    .get('deps')
    .getDb()
    .select()
    .from(users)
    .where(eq(users.id, c.get('userId')))
    .limit(1)
  if (!user) throw new AppError('UNAUTHENTICATED', 'Session ended')
  return c.json({
    username: user.username,
    profileEnc: user.profileEnc ? b64u(user.profileEnc) : null,
    totpEnabled: user.totpEnabled,
    itemCount: user.itemCount,
    itemQuota: LIMITS.maxItemsPerUser,
    maxItemBytes: LIMITS.maxItemBytes,
    kdfParams: user.kdfParams,
    createdAt: user.createdAt.toISOString(),
  })
})
