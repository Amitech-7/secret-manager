import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  deriveRecoveryKeys,
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
} from './recovery'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const FIXED_KEY = Uint8Array.from({ length: 32 }, (_, i) => i)
const FIXED_DISPLAY = '000G4-0R40M-30E20-9185G-R38E1-W8124-GK2GA-HC5RR-34D1P-70X3R-FV9A0'

describe('base32 (Crockford)', () => {
  it('matches known values', () => {
    expect(base32Encode(new Uint8Array(5))).toBe('00000000')
    expect(base32Encode(new Uint8Array(5).fill(255))).toBe('ZZZZZZZZ')
  })

  it('round-trips random buffers whose bit length is a multiple of 5', () => {
    for (const n of [5, 10, 20, 35]) {
      const bytes = crypto.getRandomValues(new Uint8Array(n))
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
    }
  })
})

describe('recovery key', () => {
  it('formats a fixed key exactly like an independent Python implementation', async () => {
    const parsed = await parseRecoveryKey(FIXED_DISPLAY)
    expect(parsed).toEqual(FIXED_KEY)
  })

  it('generates 55 characters in 11 groups of 5 and parses back to the same key', async () => {
    const { key, display } = await generateRecoveryKey()
    expect(display).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){10}[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(await parseRecoveryKey(display)).toEqual(key)
  })

  it('generates different keys each time', async () => {
    const a = await generateRecoveryKey()
    const b = await generateRecoveryKey()
    expect(a.display).not.toBe(b.display)
  })

  it('tolerates case, spaces, missing hyphens and look-alike characters', async () => {
    const lower = FIXED_DISPLAY.toLowerCase().replace(/-/g, ' ')
    expect(await parseRecoveryKey(lower)).toEqual(FIXED_KEY)
    expect(await parseRecoveryKey(FIXED_DISPLAY.replace(/-/g, ''))).toEqual(FIXED_KEY)
    // 0 typed as O, 1 typed as I or L
    const confusable = FIXED_DISPLAY.replace(/0/g, 'O').replace(/1/g, 'l')
    expect(await parseRecoveryKey(confusable)).toEqual(FIXED_KEY)
  })

  it('catches almost every single-character substitution (16-bit checksum, fixed key)', async () => {
    const chars = FIXED_DISPLAY.replace(/-/g, '')
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    let caught = 0
    let total = 0
    for (let i = 0; i < chars.length; i++) {
      for (const replacement of alphabet) {
        if (replacement === chars[i]) continue
        total++
        const bad = chars.slice(0, i) + replacement + chars.slice(i + 1)
        try {
          await parseRecoveryKey(bad)
        } catch {
          caught++
        }
      }
    }
    // A 2-byte checksum misses about 1 in 65,536 random typos (one such collision exists for this
    // key, verified independently). A missed typo is harmless: unwrapping then fails cleanly.
    expect(caught / total).toBeGreaterThan(0.999)
  })

  it('rejects wrong lengths, foreign characters and swapped neighbours', async () => {
    await expect(parseRecoveryKey('')).rejects.toMatchObject({ code: 'INVALID_RECOVERY_KEY' })
    await expect(parseRecoveryKey(FIXED_DISPLAY.slice(0, -2))).rejects.toThrow()
    await expect(parseRecoveryKey(FIXED_DISPLAY + 'A')).rejects.toThrow()
    await expect(parseRecoveryKey(FIXED_DISPLAY.replace('000G4', 'UUUU!'))).rejects.toThrow()
    const swapped = '00G04' + FIXED_DISPLAY.slice(5)
    await expect(parseRecoveryKey(swapped)).rejects.toThrow()
  })

  it('formatting helper groups in fives', () => {
    expect(formatRecoveryKey(FIXED_KEY, Uint8Array.of(0, 0))).toMatch(/^.{5}(-.{5}){10}$/)
  })

  it('derives auth and wrap keys matching the independent implementation', async () => {
    const { recoveryAuth, wrapKey } = await deriveRecoveryKeys(FIXED_KEY)
    expect(hex(recoveryAuth)).toBe(
      '81c0d54862b687728c2d647c39593c885d12500b5cf6a1ff1bfa5056db4f658f',
    )
    expect(hex(wrapKey)).toBe('447186d4a66b8dea0213b045b3ec731ecf7641def0ee16c322a2c15685a1f27c')
    expect(hex(recoveryAuth)).not.toBe(hex(wrapKey))
  })

  it('rejects recovery keys of the wrong size', async () => {
    await expect(deriveRecoveryKeys(new Uint8Array(16))).rejects.toThrow()
  })
})
