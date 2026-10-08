import { describe, expect, it, vi } from 'vitest'
import { applyPrefs } from './apply'
import { DEFAULT_PREFS, STORAGE_KEY, loadPrefs, parsePrefs, resolveMode } from './prefs'

describe('parsePrefs', () => {
  it('round-trips valid preferences and normalises the colour', () => {
    expect(parsePrefs(JSON.stringify({ mode: 'night', accent: '#ABC' }))).toEqual({
      mode: 'night',
      accent: '#aabbcc',
    })
  })

  it('falls back safely on missing, corrupt or hostile data', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '[]',
      '{"mode":"neon"}',
      '{"accent":"red"}',
      '{"accent":"#fff;color:red"}',
      '{"mode":5}',
    ]) {
      const p = parsePrefs(raw)
      expect(['system', 'light', 'dark', 'night']).toContain(p.mode)
      expect(p.accent).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(parsePrefs('{"mode":"neon"}').mode).toBe('system')
  })

  it('loadPrefs survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadPrefs(blocked)).toEqual(DEFAULT_PREFS)
    expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS)
  })
})

describe('resolveMode', () => {
  it('follows the system only in system mode', () => {
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('night', false)).toBe('night')
  })
})

describe('applyPrefs', () => {
  const makeTarget = () => {
    const attrs: Record<string, string> = {}
    const vars: Record<string, string> = {}
    const meta: Record<string, string> = {}
    const stored: Record<string, string> = {}
    return {
      attrs,
      vars,
      meta,
      stored,
      target: {
        root: {
          setAttribute: (k: string, v: string) => void (attrs[k] = v),
          style: { setProperty: (k: string, v: string) => void (vars[k] = v) },
        },
        themeColorMeta: { setAttribute: (k: string, v: string) => void (meta[k] = v) },
        storage: { setItem: (k: string, v: string) => void (stored[k] = v) },
      },
    }
  }

  it('sets the theme, accent variables and browser bar colour', () => {
    const t = makeTarget()
    expect(applyPrefs({ mode: 'night', accent: '#be123c' }, false, t.target)).toBe('night')
    expect(t.attrs['data-theme']).toBe('night')
    expect(t.vars['--sm-accent']).toBe('#be123c')
    expect(t.meta['content']).toBe('#000000')
  })

  it('resolves system mode from the system setting', () => {
    const t = makeTarget()
    expect(applyPrefs({ mode: 'system', accent: '#4f46e5' }, true, t.target)).toBe('dark')
    expect(t.meta['content']).toBe('#0b1220')
  })

  it('saves accent variables for all three themes so system mode can flip before first paint', () => {
    const t = makeTarget()
    applyPrefs({ mode: 'system', accent: '#4f46e5' }, false, t.target)
    const saved = JSON.parse(t.stored[STORAGE_KEY]!) as {
      vars: Record<string, Record<string, string>>
      themeColor: Record<string, string>
    }
    expect(Object.keys(saved.vars).sort()).toEqual(['dark', 'light', 'night'])
    expect(Object.keys(saved.vars.dark!).sort()).toEqual([
      '--sm-accent',
      '--sm-accent-hover',
      '--sm-accent-subtle',
      '--sm-link',
      '--sm-on-accent',
    ])
    expect(saved.themeColor.night).toBe('#000000')
  })

  it('does not throw when storage is blocked', () => {
    const t = makeTarget()
    t.target.storage = {
      setItem: vi.fn(() => {
        throw new Error('quota')
      }),
    }
    expect(() => applyPrefs(DEFAULT_PREFS, false, t.target)).not.toThrow()
    expect(t.attrs['data-theme']).toBe('light')
  })

  it('stores nothing secret: only mode, accent and colours', () => {
    const t = makeTarget()
    applyPrefs({ mode: 'dark', accent: '#0f766e' }, false, t.target)
    expect(Object.keys(JSON.parse(t.stored[STORAGE_KEY]!)).sort()).toEqual([
      'accent',
      'mode',
      'themeColor',
      'vars',
    ])
  })
})
