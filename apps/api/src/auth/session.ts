import { sessions, sql, type Database } from '@sm/db'
import { AUTH_LIMITS } from '@sm/shared'
import { newRefreshToken, signAccessToken } from './tokens'

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** Creates a session row and the first token pair. Keeps at most N sessions per user. */
export async function createSession(
  db: Database,
  jwtSecret: string,
  userId: string,
  now: Date,
): Promise<IssuedTokens> {
  const refresh = newRefreshToken()
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      refreshHash: refresh.hash,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + AUTH_LIMITS.refreshTokenSeconds * 1000),
    })
    .returning({ id: sessions.id })

  await db.execute(sql`
    delete from sessions
    where user_id = ${userId}
      and id not in (
        select id from sessions where user_id = ${userId}
        order by created_at desc, id limit ${AUTH_LIMITS.maxSessionsPerUser})`)

  return {
    accessToken: signAccessToken(
      jwtSecret,
      { sub: userId, sid: row!.id },
      Math.floor(now.getTime() / 1000),
      AUTH_LIMITS.accessTokenSeconds,
    ),
    refreshToken: refresh.token,
    expiresIn: AUTH_LIMITS.accessTokenSeconds,
  }
}
