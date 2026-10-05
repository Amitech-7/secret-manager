import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type { AppEnv } from '../deps'
import { AppError } from '../errors'
import { runMaintenance } from '../maintenance'

const sha256 = (s: string) => createHash('sha256').update(s).digest()

export const cron = new Hono<AppEnv>()

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when that variable is set.
cron.get('/maintenance', async (c) => {
  const deps = c.get('deps')
  const env = deps.getEnv()
  const supplied = c.req.header('authorization') ?? ''
  const expected = `Bearer ${env.CRON_SECRET}`
  // Hash both sides so the comparison is constant-time and length-independent.
  if (!timingSafeEqual(sha256(supplied), sha256(expected))) {
    throw new AppError('UNAUTHENTICATED', 'Unauthorized')
  }
  const result = await runMaintenance(deps.getDb(), deps.now(), env.DB_SIZE_LIMIT_MB)
  if (result.level !== 'ok') {
    // No email service by design: this line in the Vercel runtime logs is the alert.
    console.warn(`DB size ${result.level}: ${result.dbSizeMb} of ${result.limitMb} MB`)
  }
  return c.json(result)
})
