import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { applyPrefs } from './apply'
import { STORAGE_KEY } from './prefs'

const script = readFileSync(
  fileURLToPath(new URL('../../public/theme-init.js', import.meta.url)),
  'utf8',
)

/** Runs the real pre-paint script against a stand-in browser. */
function run(stored: string | null, systemDark = false, storageThrows = false) {
  const attrs: Record<string, string> = {}
  const vars: Record<string, string> = {}
  const meta: Record<string, string> = {}
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => void (attrs[k] = v),
        style: { setProperty: (k: string, v: string) => void (vars[k] = v) },
      },
      querySelector: () => ({ setAttribute: (k: string, v: string) => void (meta[k] = v) }),
    },
    localStorage: {
      getItem: () => {
        if (storageThrows) throw new Error('denied')
        return stored
      },
    },
    window: { matchMedia: () => ({ matches: systemDark }) },
  }
  vm.runInNewContext(script, { ...sandbox, window: sandbox.window })
  return { attrs, vars, meta }
}

describe('theme-init.js (runs before first paint)', () => {
  it('follows the system when nothing is saved', () => {
    expect(run(null, false).attrs['data-theme']).toBe('light')
    expect(run(null, true).attrs['data-theme']).toBe('dark')
  })

  it('restores a saved mode, accent variables and browser bar colour', () => {
    const t = { setItem: (_: string, v: string) => void (saved = v) }
    let saved = ''
    applyPrefs({ mode: 'night', accent: '#be123c' }, false, {
      root: { setAttribute() {}, style: { setProperty() {} } },
      storage: t,
    })
    const r = run(saved, false)
    expect(r.attrs['data-theme']).toBe('night')
    expect(r.vars['--sm-accent']).toBe('#be123c')
    expect(r.meta['content']).toBe('#000000')
  })

  it('applies the saved system-mode variables for whichever theme the system picks', () => {
    let saved = ''
    applyPrefs({ mode: 'system', accent: '#0f766e' }, false, {
      root: { setAttribute() {}, style: { setProperty() {} } },
      storage: { setItem: (_, v) => void (saved = v) },
    })
    expect(run(saved, true).attrs['data-theme']).toBe('dark')
    expect(run(saved, true).vars['--sm-link']).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('ignores unknown variable names and values that are not plain hex colours', () => {
    const hostile = JSON.stringify({
      mode: 'light',
      vars: {
        light: {
          '--sm-accent': 'url(javascript:alert(1))',
          '--sm-link': '#112233',
          '--evil': '#000000',
          '--sm-bg': '#ff0000',
          '--sm-on-accent': '#fff;x:y',
        },
      },
      themeColor: { light: 'red' },
    })
    const r = run(hostile)
    expect(r.vars).toEqual({ '--sm-link': '#112233' })
    expect(r.meta).toEqual({})
  })

  it('falls back to light on corrupt data or blocked storage', () => {
    expect(run('{{{').attrs['data-theme']).toBe('light')
    expect(run(null, true, true).attrs['data-theme']).toBe('light')
    expect(run('{"mode":"neon"}', true).attrs['data-theme']).toBe('dark')
  })

  it('uses the same storage key the app writes', () => {
    expect(script).toContain(`'${STORAGE_KEY}'`)
  })
})
