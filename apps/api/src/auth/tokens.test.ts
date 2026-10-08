import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  newRefreshToken,
  safeEqual,
  sha256,
  signAccessToken,
  signPurposeToken,
  verifyAccessToken,
  verifyPurposeToken,
} from './tokens'

const SECRET = 's'.repeat(40)
const NOW = 1_800_000_000
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const forge = (header: object, payload: object, secret = SECRET) => {
  const input = `${b64(header)}.${b64(payload)}`
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`
}
const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return (e as { code?: string }).code
  }
  return undefined
}

describe('access tokens', () => {
  it('round-trips the claims', () => {
    const token = signAccessToken(SECRET, { sub: 'u1', sid: 's1' }, NOW, 900)
    expect(verifyAccessToken(SECRET, token, NOW + 10)).toEqual({
      sub: 'u1',
      sid: 's1',
      iat: NOW,
      exp: NOW + 900,
    })
  })

  it('expires exactly at the boundary', () => {
    const token = signAccessToken(SECRET, { sub: 'u', sid: 's' }, NOW, 900)
    expect(codeOf(() => verifyAccessToken(SECRET, token, NOW + 899))).toBeUndefined()
    expect(codeOf(() => verifyAccessToken(SECRET, token, NOW + 900))).toBe('TOKEN_EXPIRED')
  })

  it('rejects a wrong secret, a tampered payload and a tampered signature', () => {
    const token = signAccessToken(SECRET, { sub: 'u', sid: 's' }, NOW, 900)
    expect(codeOf(() => verifyAccessToken('x'.repeat(40), token, NOW))).toBe('UNAUTHENTICATED')
    const [h, , sig] = token.split('.') as [string, string, string]
    const forged = `${h}.${b64({ sub: 'admin', sid: 's', iat: NOW, exp: NOW + 900 })}.${sig}`
    expect(codeOf(() => verifyAccessToken(SECRET, forged, NOW))).toBe('UNAUTHENTICATED')
    expect(codeOf(() => verifyAccessToken(SECRET, `${token.slice(0, -2)}AA`, NOW))).toBe(
      'UNAUTHENTICATED',
    )
  })

  it('rejects alg none, other algorithms and extra header fields, even when correctly signed', () => {
    const payload = { sub: 'u', sid: 's', iat: NOW, exp: NOW + 900 }
    expect(
      codeOf(() =>
        verifyAccessToken(SECRET, `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`, NOW),
      ),
    ).toBe('UNAUTHENTICATED')
    expect(
      codeOf(() => verifyAccessToken(SECRET, forge({ alg: 'HS512', typ: 'JWT' }, payload), NOW)),
    ).toBe('UNAUTHENTICATED')
    expect(
      codeOf(() =>
        verifyAccessToken(SECRET, forge({ alg: 'HS256', typ: 'JWT', kid: 'x' }, payload), NOW),
      ),
    ).toBe('UNAUTHENTICATED')
  })

  it('rejects malformed tokens and claims of the wrong type', () => {
    for (const bad of ['', 'a.b', 'a.b.c.d', '....'])
      expect(codeOf(() => verifyAccessToken(SECRET, bad, NOW))).toBe('UNAUTHENTICATED')
    const header = { alg: 'HS256', typ: 'JWT' }
    expect(
      codeOf(() =>
        verifyAccessToken(SECRET, forge(header, { sub: 1, sid: 's', iat: NOW, exp: NOW + 9 }), NOW),
      ),
    ).toBe('UNAUTHENTICATED')
    expect(
      codeOf(() => verifyAccessToken(SECRET, forge(header, { sub: 'u', sid: 's', iat: NOW }), NOW)),
    ).toBe('UNAUTHENTICATED')
  })
})

describe('refresh tokens and helpers', () => {
  it('generates unique 32-byte tokens whose hash is SHA-256 of the raw bytes', () => {
    const a = newRefreshToken()
    const b = newRefreshToken()
    expect(a.token).not.toBe(b.token)
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32)
    expect(a.hash.equals(sha256(Buffer.from(a.token, 'base64url')))).toBe(true)
  })

  it('safeEqual compares content and tolerates different lengths', () => {
    expect(safeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true)
    expect(safeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false)
    expect(safeEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false)
  })
})

describe('purpose tokens', () => {
  const sign = (purpose = 'recover', ttl = 600) =>
    signPurposeToken(SECRET, purpose, { sub: 'u1', rh: 'abc' }, NOW, ttl)

  it('round-trips claims for the right purpose', () => {
    const claims = verifyPurposeToken(SECRET, 'recover', sign(), NOW + 5)
    expect(claims).toMatchObject({ sub: 'u1', rh: 'abc', pur: 'recover' })
  })

  it('cannot be used for another purpose, or as an access token (and vice versa)', () => {
    expect(codeOf(() => verifyPurposeToken(SECRET, 'other', sign(), NOW))).toBe('UNAUTHENTICATED')
    expect(codeOf(() => verifyAccessToken(SECRET, sign(), NOW))).toBe('UNAUTHENTICATED')
    const access = signAccessToken(SECRET, { sub: 'u1', sid: 's1' }, NOW, 900)
    expect(codeOf(() => verifyPurposeToken(SECRET, 'recover', access, NOW))).toBe('UNAUTHENTICATED')
  })

  it('expires, and rejects tampering and a wrong secret', () => {
    expect(codeOf(() => verifyPurposeToken(SECRET, 'recover', sign(), NOW + 600))).toBe(
      'TOKEN_EXPIRED',
    )
    const [h, , sig] = sign().split('.') as [string, string, string]
    const forged = `${h}.${b64({ sub: 'victim', rh: 'abc', pur: 'recover', iat: NOW, exp: NOW + 600 })}.${sig}`
    expect(codeOf(() => verifyPurposeToken(SECRET, 'recover', forged, NOW))).toBe('UNAUTHENTICATED')
    expect(codeOf(() => verifyPurposeToken('x'.repeat(40), 'recover', sign(), NOW))).toBe(
      'UNAUTHENTICATED',
    )
  })

  it('a token forged with the raw secret (not the purpose key) is rejected', () => {
    const header = { alg: 'HS256', typ: 'JWT' }
    const forged = forge(header, { sub: 'u1', rh: 'abc', pur: 'recover', iat: NOW, exp: NOW + 600 })
    expect(codeOf(() => verifyPurposeToken(SECRET, 'recover', forged, NOW))).toBe('UNAUTHENTICATED')
  })
})
