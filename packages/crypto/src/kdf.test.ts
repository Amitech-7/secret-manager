import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KDF_PARAMS,
  KDF_BOUNDS,
  deriveKeys,
  encodePassword,
  randomSalt,
  validateKdfParams,
  type KdfParams,
} from './kdf'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

const SALT = Uint8Array.from({ length: 16 }, (_, i) => i)
// Cheapest allowed parameters, to keep tests fast.
const FAST: KdfParams = {
  alg: 'argon2id',
  version: 19,
  memoryKiB: KDF_BOUNDS.minMemoryKiB,
  iterations: 2,
  parallelism: 1,
}

describe('deriveKeys', () => {
  it('matches independent reference vectors (argon2-cffi + hand-written HKDF in Python)', async () => {
    const { authKey, wrapKey } = await deriveKeys('correct horse battery staple', SALT, FAST)
    expect(hex(authKey)).toBe('f59401839ebf4aa08943c3805e27f87eb05981b72cf6a6a0fb7cc8221efbf099')
    expect(hex(wrapKey)).toBe('9bea5433e29c6873e3d58bf1deb39af6c46321855399fc4718b72c6a2fa63c5c')
  })

  it('is deterministic and yields two different 32-byte keys', async () => {
    const a = await deriveKeys('pw-one', SALT, FAST)
    const b = await deriveKeys('pw-one', SALT, FAST)
    expect(hex(a.authKey)).toBe(hex(b.authKey))
    expect(hex(a.wrapKey)).toBe(hex(b.wrapKey))
    expect(a.authKey).toHaveLength(32)
    expect(a.wrapKey).toHaveLength(32)
    expect(hex(a.authKey)).not.toBe(hex(a.wrapKey))
  })

  it('changes with the password and with the salt', async () => {
    const base = await deriveKeys('pw-one', SALT, FAST)
    const otherPw = await deriveKeys('pw-two', SALT, FAST)
    const otherSalt = await deriveKeys('pw-one', randomSalt(), FAST)
    expect(hex(otherPw.wrapKey)).not.toBe(hex(base.wrapKey))
    expect(hex(otherSalt.wrapKey)).not.toBe(hex(base.wrapKey))
  })

  it('treats composed and decomposed unicode as the same password (NFKC)', async () => {
    const composed = await deriveKeys('caf\u00e9', SALT, FAST)
    const decomposed = await deriveKeys('cafe\u0301', SALT, FAST)
    expect(hex(composed.wrapKey)).toBe(hex(decomposed.wrapKey))
    expect(encodePassword('\uFF21')).toEqual(encodePassword('A')) // full-width A -> A
  })

  it('rejects bad salt length and empty passwords', async () => {
    await expect(deriveKeys('pw', new Uint8Array(8), FAST)).rejects.toThrow('salt')
    await expect(deriveKeys('', SALT, FAST)).rejects.toThrow('Empty')
  })
})

describe('validateKdfParams', () => {
  it('accepts the defaults', () => {
    expect(() => validateKdfParams(DEFAULT_KDF_PARAMS)).not.toThrow()
  })

  it('rejects downgraded or oversized parameters', () => {
    const bad: KdfParams[] = [
      { ...FAST, memoryKiB: 1024 },
      { ...FAST, iterations: 1 },
      { ...FAST, memoryKiB: KDF_BOUNDS.maxMemoryKiB + 1 },
      { ...FAST, parallelism: 0 },
      { ...FAST, parallelism: 99 },
      { ...FAST, memoryKiB: 65536.5 },
      { ...FAST, version: 16 as unknown as 19 },
    ]
    for (const p of bad) expect(() => validateKdfParams(p)).toThrow('Invalid KDF')
  })
})
