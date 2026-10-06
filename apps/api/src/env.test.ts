import { describe, expect, it } from 'vitest'
import { TEST_SOURCE, testEnv } from './testkit'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('accepts the minimum, applies defaults and splits origins', () => {
    const env = testEnv()
    expect(env.DB_SIZE_LIMIT_MB).toBe(512)
    expect(env.ALLOWED_ORIGINS).toEqual(['https://localhost', 'capacitor://localhost'])
    const minimal = parseEnv({
      DATABASE_URL: TEST_SOURCE.DATABASE_URL,
      CRON_SECRET: TEST_SOURCE.CRON_SECRET,
      RATE_LIMIT_SECRET: TEST_SOURCE.RATE_LIMIT_SECRET,
    })
    expect(minimal.JWT_SECRET).toBeUndefined()
    expect(minimal.FAKE_SALT_SECRET).toBeUndefined()
  })

  it('has no allowed origins when none are configured', () => {
    expect(testEnv({ ALLOWED_ORIGINS: '' }).ALLOWED_ORIGINS).toEqual([])
  })

  it('rejects missing and weak values, naming the variable but never its value', () => {
    const attempt = (source: Record<string, string | undefined>) => {
      try {
        parseEnv(source)
      } catch (e) {
        return (e as Error).message
      }
      return ''
    }
    expect(attempt({})).toMatch(/DATABASE_URL.*CRON_SECRET.*RATE_LIMIT_SECRET/)
    const weak = attempt({ ...TEST_SOURCE, CRON_SECRET: 'short-secret-value' })
    expect(weak).toContain('CRON_SECRET')
    expect(weak).not.toContain('short-secret-value')
    expect(attempt({ ...TEST_SOURCE, DATABASE_URL: 'mysql://x' })).toContain('DATABASE_URL')
    expect(attempt({ ...TEST_SOURCE, TOTP_ENC_KEY: 'not-a-key' })).toContain('TOTP_ENC_KEY')
    expect(attempt({ ...TEST_SOURCE, DB_SIZE_LIMIT_MB: '-5' })).toContain('DB_SIZE_LIMIT_MB')
  })
})
