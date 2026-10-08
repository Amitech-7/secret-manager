import { createHmac } from 'node:crypto'
import { rateLimits, sql, type Database } from '@sm/db'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from './deps'
import { AppError } from './errors'

export function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex').slice(0, 32)
}

/**
 * Vercel sets these headers itself, so a client cannot spoof them there. If hosting changes,
 * revisit this function.
 */
export function clientIp(c: Context): string {
  return (
    c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  )
}

export interface HitResult {
  count: number
  retryAfter: number
}

/** Fixed-window counter in Postgres: one atomic upsert per request, no extra vendor. */
export async function hit(
  db: Database,
  key: string,
  windowSec: number,
  now: Date,
): Promise<HitResult> {
  const windowMs = windowSec * 1000
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: new Date(startMs), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count })
  const retryAfter = Math.max(1, Math.ceil((startMs + windowMs - now.getTime()) / 1000))
  return { count: row?.count ?? 1, retryAfter }
}

export interface RateLimitOptions<E extends AppEnv = AppEnv> {
  /** Name of the endpoint group, e.g. "auth-login". Counters are separate per group. */
  group: string
  limit: number
  windowSec: number
  /** Extra identity to count against besides the client IP, e.g. an HMAC of a username. */
  identity?: (c: Context<E>) => string | Promise<string>
}

export function rateLimit<E extends AppEnv = AppEnv>(
  options: RateLimitOptions<E>,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const deps = c.get('deps')
    const secret = deps.getEnv().RATE_LIMIT_SECRET
    const who = options.identity ? await options.identity(c) : clientIp(c)
    // Only a keyed hash of the identity is stored, never the raw IP or username.
    const key = `${options.group}:${hmacHex(secret, who)}`
    const { count, retryAfter } = await hit(deps.getDb(), key, options.windowSec, deps.now())
    if (count > options.limit) {
      throw new AppError('RATE_LIMITED', 'Too many requests, try again later', { retryAfter })
    }
    await next()
  }
}
