import { describe, expect, it } from 'vitest'
import { concat, fromBase64Url, fromUtf8, toBase64Url, utf8 } from './bytes'

describe('base64url', () => {
  it('round-trips every length from 0 to 40 bytes', () => {
    for (let n = 0; n <= 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    }
  })

  it('round-trips large buffers', () => {
    // getRandomValues is limited to 65,536 bytes per call, so fill in chunks.
    const bytes = new Uint8Array(200_000)
    for (let i = 0; i < bytes.length; i += 65_536) {
      crypto.getRandomValues(bytes.subarray(i, i + 65_536))
    }
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
  })

  it('uses the url-safe alphabet without padding', () => {
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff, 0xfe))).toBe('-__-')
    expect(toBase64Url(Uint8Array.of(1))).toBe('AQ')
  })

  it('rejects padding, foreign characters, bad lengths and non-canonical input', () => {
    for (const bad of ['AQ==', 'A+B/', 'A', 'AB CD', 'AR']) {
      expect(() => fromBase64Url(bad)).toThrow()
    }
  })
})

describe('helpers', () => {
  it('concatenates and converts utf8', () => {
    expect(concat(Uint8Array.of(1), Uint8Array.of(2, 3))).toEqual(Uint8Array.of(1, 2, 3))
    expect(fromUtf8(utf8('h\u00e9llo \u0928\u092e\u0938\u094d\u0924\u0947'))).toBe(
      'h\u00e9llo \u0928\u092e\u0938\u094d\u0924\u0947',
    )
    expect(() => fromUtf8(Uint8Array.of(0xff, 0xfe))).toThrow()
  })
})
