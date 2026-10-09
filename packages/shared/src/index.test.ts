import { describe, expect, it } from 'vitest'
import { ERROR_CODES, ITEM_TYPES, LIMITS, USERNAME_PATTERN } from './index'

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

  it('keeps a full vault page under the hosting response cap', () => {
    const base64Len = Math.ceil((LIMITS.maxItemBytes * 4) / 3)
    const perItemJson = 300 // id, type, version, timestamps and punctuation, generously
    const worstPage = LIMITS.vaultPageMaxItems * (base64Len + perItemJson)
    expect(worstPage).toBeLessThan(4_500_000)
  })

  it('has no note item type', () => {
    expect(ITEM_TYPES).not.toContain('note')
    expect([...ITEM_TYPES].sort()).toEqual(
      ['account', 'account_type', 'bank', 'card', 'credential', 'member'].sort(),
    )
  })
})
