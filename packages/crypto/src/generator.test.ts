import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GENERATOR,
  GENERATOR_LIMITS,
  estimateBits,
  generatePassword,
  poolSize,
  randomInt,
  type GeneratorOptions,
  type RandomBytes,
} from './generator'

const opts = (over: Partial<GeneratorOptions> = {}): GeneratorOptions => ({
  ...DEFAULT_GENERATOR,
  ...over,
})

/** Feeds a fixed list of 32-bit values, then repeats the last one. */
const fixed = (...values: number[]): RandomBytes & { calls: number } => {
  let i = 0
  const fn = ((length: number) => {
    fn.calls++
    const v = values[Math.min(i++, values.length - 1)]!
    return new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, length))
  }) as RandomBytes & { calls: number }
  fn.calls = 0
  return fn
}

describe('randomInt', () => {
  it('rejects values that would skew the result', () => {
    // For max 3 the largest safe value is 4294967294; 0xFFFFFFFF would favour 0.
    const rng = fixed(0xffffffff, 5)
    expect(randomInt(3, rng)).toBe(2)
    expect(rng.calls).toBe(2)
  })

  it('covers every value roughly equally', () => {
    const counts = new Array<number>(7).fill(0)
    const draws = 70_000
    for (let i = 0; i < draws; i++) counts[randomInt(7)]!++
    for (const c of counts) expect(Math.abs(c - draws / 7)).toBeLessThan(600) // about 6 sigma
  })

  it('refuses bad ranges', () => {
    for (const bad of [0, -1, 1.5, 2 ** 32 + 1]) {
      expect(() => randomInt(bad)).toThrow(/Range/)
    }
    expect(randomInt(1)).toBe(0)
  })
})

describe('generatePassword', () => {
  it('has the requested length and characters from every chosen kind', () => {
    for (let n = 0; n < 200; n++) {
      const p = generatePassword(opts({ length: 12 }))
      expect(p).toHaveLength(12)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[!#$%&*+\-=?@^_]/)
    }
  })

  it('uses only the chosen kinds', () => {
    for (let n = 0; n < 50; n++) {
      expect(generatePassword(opts({ upper: false, symbols: false, digits: false }))).toMatch(
        /^[a-z]+$/,
      )
      expect(generatePassword(opts({ lower: false, upper: false, symbols: false }))).toMatch(
        /^[0-9]+$/,
      )
    }
  })

  it('leaves out look-alike characters when asked, and keeps them otherwise', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 300; n++) {
      const strict = generatePassword(opts({ length: 40 }))
      expect(strict).not.toMatch(/[0Oo1lI|]/)
      for (const c of generatePassword(opts({ length: 40, avoidAmbiguous: false }))) seen.add(c)
    }
    for (const c of '0Oo1lI') expect(seen.has(c)).toBe(true)
  })

  it('does not park the guaranteed characters at the front', () => {
    let digitFirst = 0
    const runs = 3000
    for (let n = 0; n < runs; n++) {
      if (/[0-9]/.test(generatePassword(opts({ length: 8 }))[0]!)) digitFirst++
    }
    // Roughly 8/60 of the pool is digits; a front-loaded generator would sit near 100% or 0%.
    expect(digitFirst / runs).toBeGreaterThan(0.05)
    expect(digitFirst / runs).toBeLessThan(0.3)
  })

  it('is different every time', () => {
    const all = new Set(Array.from({ length: 500 }, () => generatePassword()))
    expect(all.size).toBe(500)
  })

  it('is deterministic for a given random source', () => {
    const make = () => {
      let n = 12345
      return ((length: number) => {
        const out = new Uint8Array(length)
        for (let i = 0; i < length; i++) {
          n = (n * 1103515245 + 12345) & 0x7fffffff
          out[i] = n >>> 16
        }
        return out
      }) as RandomBytes
    }
    expect(generatePassword(opts(), make())).toBe(generatePassword(opts(), make()))
  })

  it('refuses unusable settings', () => {
    const none = { lower: false, upper: false, digits: false, symbols: false }
    expect(() => generatePassword(opts(none))).toThrow(/at least one/)
    expect(() => generatePassword(opts({ length: GENERATOR_LIMITS.minLength - 1 }))).toThrow(
      /length/,
    )
    expect(() => generatePassword(opts({ length: GENERATOR_LIMITS.maxLength + 1 }))).toThrow(
      /length/,
    )
    expect(() => generatePassword(opts({ length: 12.5 }))).toThrow(/length/)
  })

  it('accepts the length limits', () => {
    expect(generatePassword(opts({ length: GENERATOR_LIMITS.minLength }))).toHaveLength(8)
    expect(generatePassword(opts({ length: GENERATOR_LIMITS.maxLength }))).toHaveLength(64)
  })
})

describe('strength estimate', () => {
  it('reports pool size and bits conservatively', () => {
    expect(poolSize(opts({ avoidAmbiguous: false }))).toBe(26 + 26 + 10 + 13)
    expect(
      poolSize(opts({ upper: false, digits: false, symbols: false, avoidAmbiguous: false })),
    ).toBe(26)
    expect(estimateBits(opts({ length: 20 }))).toBeGreaterThan(110)
    expect(estimateBits(opts({ length: 8, upper: false, symbols: false, digits: false }))).toBe(
      Math.floor(8 * Math.log2(23)),
    )
  })
})
