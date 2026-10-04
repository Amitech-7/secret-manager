import { describe, expect, it } from 'vitest'
import { ERROR_CODES, LIMITS, USERNAME_PATTERN } from './index'

describe('shared constants', () => {
  it('keeps the agreed quotas', () => {
    expect(LIMITS.maxItemsPerUser).toBe(1000)
    expect(LIMITS.maxItemBytes).toBe(8192)
  })

  it('validates usernames', () => {
    expect(USERNAME_PATTERN.test('arjun.dev-1')).toBe(true)
    expect(USERNAME_PATTERN.test('Has Space')).toBe(false)
  })

  it('has unique error codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})
