import { describe, expect, it } from 'vitest'
import { checkPassword } from './strength'

describe('checkPassword', () => {
  it('rejects short passwords without loading the dictionaries', async () => {
    const r = await checkPassword('Ab1!xyz')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('12')
  })

  it('rejects long but guessable passwords', async () => {
    for (const weak of ['password1234', 'qwertyuiop12', '123456789012', 'Password123456!']) {
      expect((await checkPassword(weak)).ok, weak).toBe(false)
    }
  })

  it('accepts a long random-word passphrase', async () => {
    const r = await checkPassword('violet tractor ceiling marathon pebble')
    expect(r.ok).toBe(true)
    expect(r.score).toBeGreaterThanOrEqual(3)
  })

  it('penalises passwords built from the username', async () => {
    const alone = await checkPassword('arjun-secret-vault-2026')
    const withInput = await checkPassword('arjun-secret-vault-2026', ['arjun', 'secret'])
    expect(withInput.score).toBeLessThanOrEqual(alone.score)
  })
})
