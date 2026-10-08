import { eq, users } from '@sm/db'
import { LIMITS } from '@sm/shared'
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { deleteAccountSchema } from '../auth/schemas'
import { b64u, safeEqual, sha256 } from '../auth/tokens'
import type { AuthedEnv } from '../deps'
import { AppError } from '../errors'
import { rateLimit } from '../rateLimit'
import { parseJson } from '../validate'

export const me = new Hono<AuthedEnv>()

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
    // Public ciphertext: the client re-derives keys from it when changing the password.
    kdfSalt: b64u(user.kdfSalt),
    wrappedVkPw: b64u(user.wrappedVkPw),
    createdAt: user.createdAt.toISOString(),
  })
})

// Deleting an account removes the user, every item and every session (database cascade).
me.delete(
  '/',
  rateLimit<AuthedEnv>({
    group: 'delete',
    limit: 5,
    windowSec: 900,
    identity: (c) => c.get('userId'),
  }),
  async (c) => {
    const deps = c.get('deps')
    const { authKey } = await parseJson(c, deleteAccountSchema)
    const db = deps.getDb()
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, c.get('userId')))
      .limit(1)
    if (
      !user ||
      !safeEqual(sha256(new Uint8Array(Buffer.from(authKey, 'base64url'))), user.authHash)
    ) {
      throw new AppError('INVALID_CREDENTIALS', 'Wrong password')
    }
    await db.delete(users).where(eq(users.id, user.id))
    return c.body(null, 204)
  },
)
