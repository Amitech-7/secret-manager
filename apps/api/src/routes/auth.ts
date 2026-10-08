import { createHmac } from 'node:crypto'
import { and, eq, isNull, ne, sessions, sql, users, vaultItems } from '@sm/db'
import { AUTH_LIMITS, DEFAULT_KDF_PARAMS } from '@sm/shared'
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { createSession } from '../auth/session'
import { requireSecret } from '../auth/secrets'
import {
  loginSchema,
  passwordChangeSchema,
  recoverBeginSchema,
  recoverCompleteSchema,
  recoveryRotateSchema,
  refreshSchema,
  registerSchema,
  saltRequestSchema,
} from '../auth/schemas'
import {
  b64u,
  newRefreshToken,
  safeEqual,
  sha256,
  signAccessToken,
  signPurposeToken,
  verifyPurposeToken,
} from '../auth/tokens'
import type { AuthedEnv } from '../deps'
import { AppError } from '../errors'
import { clientIp, rateLimit } from '../rateLimit'
import { parseJson } from '../validate'

export const auth = new Hono<AuthedEnv>()

const RECOVERY_TOKEN_SECONDS = 600

/** Per-user limit for sensitive actions behind a login. Wrong attempts count too. */
const perUser = (group: string, limit: number, windowSec: number) =>
  rateLimit<AuthedEnv>({ group, limit, windowSec, identity: (c) => c.get('userId') })

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64url'))

/** Used so that an unknown username costs the same comparison as a wrong password. */
const DUMMY_HASH = sha256('secret-manager/dummy-auth-hash')

async function usernameOf(c: { req: { json: () => Promise<unknown> } }): Promise<string> {
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown }
  return typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; i++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true
  }
  return false
}

// --- salt -------------------------------------------------------------------------------------

auth.post('/salt', rateLimit({ group: 'salt', limit: 10, windowSec: 60 }), async (c) => {
  const deps = c.get('deps')
  const { username } = await parseJson(c, saltRequestSchema)
  const [user] = await deps
    .getDb()
    .select({ kdfSalt: users.kdfSalt, kdfParams: users.kdfParams })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (user) return c.json({ kdfSalt: b64u(user.kdfSalt), kdfParams: user.kdfParams })

  // Unknown user: a stable, secret-keyed fake that looks exactly like a real answer.
  const secret = requireSecret(deps.getEnv().FAKE_SALT_SECRET, 'FAKE_SALT_SECRET')
  const fake = createHmac('sha256', secret).update(`salt:${username}`).digest().subarray(0, 16)
  return c.json({ kdfSalt: b64u(fake), kdfParams: DEFAULT_KDF_PARAMS })
})

// --- register ---------------------------------------------------------------------------------

auth.post('/register', rateLimit({ group: 'register', limit: 3, windowSec: 3600 }), async (c) => {
  const deps = c.get('deps')
  const env = deps.getEnv()
  const jwtSecret = requireSecret(env.JWT_SECRET, 'JWT_SECRET')
  const body = await parseJson(c, registerSchema)

  if (!(await deps.verifyTurnstile(body.turnstileToken, clientIp(c)))) {
    throw new AppError('CAPTCHA_FAILED', 'Captcha check failed')
  }

  const db = deps.getDb()
  const now = deps.now()
  let userId: string
  try {
    userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          username: body.username,
          authHash: sha256(bytes(body.authKey)),
          kdfSalt: bytes(body.kdfSalt),
          kdfParams: body.kdfParams,
          wrappedVkPw: bytes(body.wrappedVkPw),
          wrappedVkRec: bytes(body.wrappedVkRec),
          recoveryAuthHash: sha256(bytes(body.recoveryAuth)),
          profileEnc: body.profileEnc ? bytes(body.profileEnc) : null,
          itemCount: body.seedItems.length,
          createdAt: now,
          lastLoginAt: now,
        })
        .returning({ id: users.id })
      if (body.seedItems.length > 0) {
        await tx.insert(vaultItems).values(
          body.seedItems.map((item) => ({
            id: item.id,
            userId: user!.id,
            type: item.type,
            ciphertext: bytes(item.ciphertext),
            createdAt: now,
            updatedAt: now,
          })),
        )
      }
      return user!.id
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, body.username))
        .limit(1)
      if (taken) throw new AppError('USERNAME_TAKEN', 'That username is already taken')
      throw new AppError('VALIDATION', 'Duplicate item id')
    }
    throw err
  }

  const tokens = await createSession(db, jwtSecret, userId, now)
  return c.json({ userId, ...tokens }, 201)
})

// --- login ------------------------------------------------------------------------------------

auth.post(
  '/login',
  rateLimit({ group: 'login', limit: 10, windowSec: 60 }),
  // Counted per username whether or not the password is right, and whether or not the user exists.
  rateLimit({ group: 'login-user', limit: 10, windowSec: 900, identity: (c) => usernameOf(c) }),
  async (c) => {
    const deps = c.get('deps')
    const jwtSecret = requireSecret(deps.getEnv().JWT_SECRET, 'JWT_SECRET')
    const { username, authKey } = await parseJson(c, loginSchema)
    const db = deps.getDb()

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)
    const supplied = sha256(bytes(authKey))
    const ok = safeEqual(supplied, user ? user.authHash : DUMMY_HASH) && user !== undefined
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'Wrong username or password')

    const now = deps.now()
    await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id))
    const tokens = await createSession(db, jwtSecret, user.id, now)
    return c.json({
      ...tokens,
      wrappedVkPw: b64u(user.wrappedVkPw),
      kdfSalt: b64u(user.kdfSalt),
      kdfParams: user.kdfParams,
      profileEnc: user.profileEnc ? b64u(user.profileEnc) : null,
    })
  },
)

// --- refresh ----------------------------------------------------------------------------------

auth.post('/refresh', rateLimit({ group: 'refresh', limit: 30, windowSec: 60 }), async (c) => {
  const deps = c.get('deps')
  const jwtSecret = requireSecret(deps.getEnv().JWT_SECRET, 'JWT_SECRET')
  const { refreshToken } = await parseJson(c, refreshSchema)
  const db = deps.getDb()
  const now = deps.now()
  const oldHash = sha256(bytes(refreshToken))
  const next = newRefreshToken()

  // One atomic statement: only the holder of the current token can rotate it, exactly once.
  const [rotated] = await db
    .update(sessions)
    .set({ prevRefreshHash: sessions.refreshHash, refreshHash: next.hash, lastUsedAt: now })
    .where(
      and(
        eq(sessions.refreshHash, oldHash),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > ${now}`,
      ),
    )
    .returning({ id: sessions.id, userId: sessions.userId })

  if (!rotated) {
    // A token that was already rotated being presented again means it may have been stolen:
    // end the whole session. The answer is the same either way, so nothing can be probed.
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.prevRefreshHash, oldHash), isNull(sessions.revokedAt)))
    throw new AppError('UNAUTHENTICATED', 'Session ended')
  }

  return c.json({
    accessToken: signAccessToken(
      jwtSecret,
      { sub: rotated.userId, sid: rotated.id },
      Math.floor(now.getTime() / 1000),
      AUTH_LIMITS.accessTokenSeconds,
    ),
    refreshToken: next.token,
    expiresIn: AUTH_LIMITS.accessTokenSeconds,
  })
})

// --- logout -----------------------------------------------------------------------------------

auth.post('/logout', rateLimit({ group: 'logout', limit: 30, windowSec: 60 }), async (c) => {
  const deps = c.get('deps')
  const { refreshToken } = await parseJson(c, refreshSchema)
  await deps
    .getDb()
    .update(sessions)
    .set({ revokedAt: deps.now() })
    .where(and(eq(sessions.refreshHash, sha256(bytes(refreshToken))), isNull(sessions.revokedAt)))
  // Idempotent and uniform: unknown tokens get the same answer.
  return c.body(null, 204)
})

// --- change password (signed in) --------------------------------------------------------------

auth.post('/password/change', requireAuth, perUser('pw-change', 5, 900), async (c) => {
  const deps = c.get('deps')
  const body = await parseJson(c, passwordChangeSchema)
  const db = deps.getDb()
  const userId = c.get('userId')

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || !safeEqual(sha256(bytes(body.currentAuthKey)), user.authHash)) {
    throw new AppError('INVALID_CREDENTIALS', 'Wrong password')
  }

  const now = deps.now()
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        authHash: sha256(bytes(body.newAuthKey)),
        kdfSalt: bytes(body.newKdfSalt),
        kdfParams: body.newKdfParams,
        wrappedVkPw: bytes(body.newWrappedVkPw),
      })
      .where(eq(users.id, userId))
    // Every other device is signed out. This one keeps its session.
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(sessions.userId, userId),
          ne(sessions.id, c.get('sessionId')),
          isNull(sessions.revokedAt),
        ),
      )
  })
  return c.body(null, 204)
})

// --- rotate the recovery key (signed in) ------------------------------------------------------

auth.post('/recovery/rotate', requireAuth, perUser('recovery-rotate', 5, 900), async (c) => {
  const deps = c.get('deps')
  const body = await parseJson(c, recoveryRotateSchema)
  const db = deps.getDb()
  const userId = c.get('userId')

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || !safeEqual(sha256(bytes(body.currentAuthKey)), user.authHash)) {
    throw new AppError('INVALID_CREDENTIALS', 'Wrong password')
  }
  await db
    .update(users)
    .set({
      wrappedVkRec: bytes(body.newWrappedVkRec),
      recoveryAuthHash: sha256(bytes(body.newRecoveryAuth)),
    })
    .where(eq(users.id, userId))
  return c.body(null, 204)
})

// --- forgot password: step 1, prove possession of the recovery key ----------------------------

auth.post(
  '/recover/begin',
  rateLimit({ group: 'recover-ip', limit: 5, windowSec: 3600 }),
  rateLimit({ group: 'recover-user', limit: 5, windowSec: 3600, identity: (c) => usernameOf(c) }),
  async (c) => {
    const deps = c.get('deps')
    const jwtSecret = requireSecret(deps.getEnv().JWT_SECRET, 'JWT_SECRET')
    const { username, recoveryAuth } = await parseJson(c, recoverBeginSchema)

    const [user] = await deps
      .getDb()
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1)
    const supplied = sha256(bytes(recoveryAuth))
    const ok = safeEqual(supplied, user ? user.recoveryAuthHash : DUMMY_HASH) && user !== undefined
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'Wrong username or recovery key')

    // The token carries a fingerprint of the current recovery hash. Completing recovery replaces
    // that hash, so the token can be used exactly once without any extra table.
    const token = signPurposeToken(
      jwtSecret,
      'recover',
      { sub: user.id, rh: b64u(user.recoveryAuthHash.subarray(0, 8)) },
      Math.floor(deps.now().getTime() / 1000),
      RECOVERY_TOKEN_SECONDS,
    )
    return c.json({
      wrappedVkRec: b64u(user.wrappedVkRec),
      recoveryToken: token,
      expiresIn: RECOVERY_TOKEN_SECONDS,
    })
  },
)

// --- forgot password: step 2, set the new password and the replacement recovery key -----------

auth.post(
  '/recover/complete',
  rateLimit({ group: 'recover-complete', limit: 10, windowSec: 3600 }),
  async (c) => {
    const deps = c.get('deps')
    const jwtSecret = requireSecret(deps.getEnv().JWT_SECRET, 'JWT_SECRET')
    const body = await parseJson(c, recoverCompleteSchema)
    const db = deps.getDb()
    const now = deps.now()

    const claims = verifyPurposeToken(
      jwtSecret,
      'recover',
      body.recoveryToken,
      Math.floor(now.getTime() / 1000),
    )
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, claims.sub ?? ''))
      .limit(1)
    const spent = () => new AppError('UNAUTHENTICATED', 'Recovery session ended. Start again.')
    if (!user || claims.rh !== b64u(user.recoveryAuthHash.subarray(0, 8))) throw spent()

    const newRecoveryHash = sha256(bytes(body.newRecoveryAuth))
    if (safeEqual(newRecoveryHash, user.recoveryAuthHash)) {
      throw new AppError('VALIDATION', 'A new recovery key is required')
    }

    await db.transaction(async (tx) => {
      // The WHERE on the old recovery hash makes this atomic: of two concurrent attempts with
      // the same token, only one can succeed.
      const updated = await tx
        .update(users)
        .set({
          authHash: sha256(bytes(body.newAuthKey)),
          kdfSalt: bytes(body.newKdfSalt),
          kdfParams: body.newKdfParams,
          wrappedVkPw: bytes(body.newWrappedVkPw),
          wrappedVkRec: bytes(body.newWrappedVkRec),
          recoveryAuthHash: newRecoveryHash,
          // A second factor must be set up again after recovery.
          totpEnabled: false,
          totpSecretEnc: null,
          totpPendingEnc: null,
          lastLoginAt: now,
        })
        .where(and(eq(users.id, user.id), eq(users.recoveryAuthHash, user.recoveryAuthHash)))
        .returning({ id: users.id })
      if (updated.length === 0) throw spent()
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
    })

    const tokens = await createSession(db, jwtSecret, user.id, now)
    return c.json(tokens)
  },
)
