import { describe, expect, it } from 'vitest'
import { BASE_TOKENS, RESOLVED_THEMES } from './tokens'
import {
  buttonColors,
  contrast,
  hexToHsl,
  hslToHex,
  linkColor,
  luminance,
  mix,
  normalizeHex,
} from './colors'

// Deterministic pseudo-random colours so a failure is reproducible.
function* randomColors(count: number, seed = 12345) {
  let s = seed
  const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (let i = 0; i < count; i++) {
    yield '#' +
      [next(), next(), next()]
        .map((v) =>
          Math.floor(v * 256)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
  }
}

describe('normalizeHex', () => {
  it('accepts #rgb and #rrggbb in any case, with or without #', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('4F46E5')).toBe('#4f46e5')
    expect(normalizeHex('  #00ff00 ')).toBe('#00ff00')
  })

  it('rejects anything else, including CSS injection attempts', () => {
    for (const bad of [
      '',
      'red',
      '#12',
      '#12345',
      '#1234567',
      '#gggggg',
      'url(javascript:1)',
      '#fff;color:red',
      'rgb(0,0,0)',
    ]) {
      expect(normalizeHex(bad)).toBeNull()
    }
  })
})

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBe(1)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrast('#336699', '#f0f0f0')).toBeCloseTo(contrast('#f0f0f0', '#336699'), 10)
  })

  it('round-trips through HSL within rounding error', () => {
    for (const hex of randomColors(100)) {
      const { h, s, l } = hexToHsl(hex)
      const back = hslToHex(h, s, l)
      const diff = ['1', '3', '5'].map((i) =>
        Math.abs(parseInt(hex.slice(+i, +i + 2), 16) - parseInt(back.slice(+i, +i + 2), 16)),
      )
      expect(Math.max(...diff)).toBeLessThanOrEqual(1)
    }
  })

  it('mix blends linearly', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('buttonColors', () => {
  it('picks white or black text, whichever reads better, and never changes the colour', () => {
    expect(buttonColors('#4f46e5')).toEqual({ accent: '#4f46e5', onAccent: '#ffffff' })
    expect(buttonColors('#ffff00')).toEqual({ accent: '#ffff00', onAccent: '#000000' })
    expect(buttonColors('#ABC')).toEqual({ accent: '#aabbcc', onAccent: '#000000' })
  })

  it('is readable for 2,000 random colours, never below the 4.58:1 mathematical floor', () => {
    for (const hex of randomColors(2000)) {
      const { accent, onAccent } = buttonColors(hex)
      expect(contrast(accent, onAccent), `${hex}`).toBeGreaterThanOrEqual(4.58)
    }
  })

  it('handles the awkward mid-tones, where black and white are nearly tied', () => {
    for (const hex of [
      '#777777',
      '#808080',
      '#767676',
      '#8a8a8a',
      '#7f7f7f',
      '#7a7a2a',
      '#2a7a7a',
    ]) {
      const { accent, onAccent } = buttonColors(hex)
      expect(contrast(accent, onAccent), hex).toBeGreaterThanOrEqual(4.58)
    }
  })

  it('falls back to the default colour for invalid input', () => {
    expect(buttonColors('nonsense').accent).toBe('#4f46e5')
  })
})

describe('linkColor', () => {
  it.each(RESOLVED_THEMES)(
    'is readable on every surface of the %s theme, for 600 random colours',
    (theme) => {
      const t = BASE_TOKENS[theme]
      for (const hex of randomColors(600, 99)) {
        const link = linkColor(hex, [t.bg, t.surface, t.raised])
        for (const bg of [t.bg, t.surface, t.raised]) {
          expect(contrast(link, bg), `${hex} -> ${link} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    },
  )

  it('keeps the colour when it is already readable', () => {
    expect(linkColor('#1d4ed8', ['#ffffff'])).toBe('#1d4ed8')
  })
})
