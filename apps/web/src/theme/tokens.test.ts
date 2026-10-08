import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrast } from './colors'
import { renderTokenCss } from './css'
import {
  ACCENT_PRESETS,
  BASE_TOKENS,
  DEFAULT_ACCENT,
  RESOLVED_THEMES,
  accentVars,
  allVars,
} from './tokens'

describe.each(RESOLVED_THEMES)('%s theme palette', (theme) => {
  const t = BASE_TOKENS[theme]
  const surfaces = [t.bg, t.surface, t.raised]

  it('has readable text, muted text, errors and success on every surface (4.5:1)', () => {
    for (const key of ['fg', 'muted', 'danger', 'success'] as const) {
      for (const bg of surfaces)
        expect(contrast(t[key], bg), `${key} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('has visible form-control outlines (3:1)', () => {
    for (const bg of [t.bg, t.surface])
      expect(contrast(t.borderStrong, bg)).toBeGreaterThanOrEqual(3)
  })

  it('every preset gives readable buttons, hover states, links and tinted backgrounds', () => {
    for (const preset of [...ACCENT_PRESETS, { name: 'default', hex: DEFAULT_ACCENT }]) {
      const v = accentVars(preset.hex, theme)
      expect(
        contrast(v['--sm-accent']!, v['--sm-on-accent']!),
        `${preset.name} button`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(v['--sm-accent-hover']!, v['--sm-on-accent']!),
        `${preset.name} hover`,
      ).toBeGreaterThanOrEqual(4.5)
      for (const bg of surfaces)
        expect(contrast(v['--sm-link']!, bg), `${preset.name} link`).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(t.fg, v['--sm-accent-subtle']!),
        `${preset.name} subtle`,
      ).toBeGreaterThanOrEqual(7)
      expect(
        contrast(t.muted, v['--sm-accent-subtle']!),
        `${preset.name} subtle muted`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('accent presets', () => {
  it('are all valid, distinct, and need no automatic adjustment', () => {
    expect(new Set(ACCENT_PRESETS.map((p) => p.hex)).size).toBe(ACCENT_PRESETS.length)
    for (const p of ACCENT_PRESETS) expect(accentVars(p.hex, 'light')['--sm-accent']).toBe(p.hex)
  })
})

describe('generated token CSS', () => {
  it('is up to date (run `pnpm --filter @sm/web tokens` if this fails)', () => {
    const file = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')
    expect(file).toBe(renderTokenCss())
  })

  it('defines every variable for every theme', () => {
    const css = renderTokenCss()
    const names = Object.keys(allVars(DEFAULT_ACCENT).light)
    expect(names.length).toBe(14)
    for (const name of names) expect(css.split(`${name}:`).length - 1).toBeGreaterThanOrEqual(4) // 3 themes + system fallback
  })

  it('uses the dark colour scheme for both dark themes', () => {
    const css = renderTokenCss()
    expect(css).toMatch(/\[data-theme='dark'\] \{\n {2}color-scheme: dark;/)
    expect(css).toMatch(/\[data-theme='night'\] \{\n {2}color-scheme: dark;/)
  })
})
