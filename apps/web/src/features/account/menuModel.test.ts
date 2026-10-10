import { describe, expect, it } from 'vitest'
import { MENU_SCREENS, initialOf } from './menuModel'

describe('initialOf', () => {
  it('shows one capital letter', () => {
    expect(initialOf('arjun.dev')).toBe('A')
    expect(initialOf('  zed ')).toBe('Z')
    expect(initialOf('_x')).toBe('_')
  })

  it('copes with empty names and characters outside the basic plane', () => {
    expect(initialOf('')).toBe('?')
    expect(initialOf('   ')).toBe('?')
    expect(initialOf('😀smile')).toBe('😀')
  })
})

describe('menu', () => {
  it('lists each screen exactly once', () => {
    expect(MENU_SCREENS.map((m) => m.screen)).toEqual(['vault', 'backup', 'settings'])
  })
})
