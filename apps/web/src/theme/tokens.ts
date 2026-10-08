import { buttonColors, linkColor, mix, normalizeHex } from './colors'

export const RESOLVED_THEMES = ['light', 'dark', 'night'] as const
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number]

export interface BaseTokens {
  bg: string
  surface: string
  raised: string
  /** Decorative dividers only. */
  border: string
  /** Form-control outlines: at least 3:1 against the surface (WCAG non-text contrast). */
  borderStrong: string
  fg: string
  muted: string
  danger: string
  success: string
}

export const BASE_TOKENS: Record<ResolvedTheme, BaseTokens> = {
  light: {
    bg: '#f4f6fa',
    surface: '#ffffff',
    raised: '#eceff5',
    border: '#d5dbe5',
    borderStrong: '#6b7686',
    fg: '#0f172a',
    muted: '#4b5565',
    danger: '#b42318',
    success: '#116a33',
  },
  dark: {
    bg: '#0b1220',
    surface: '#121a2c',
    raised: '#1a2338',
    border: '#2a3650',
    borderStrong: '#7a8aa6',
    fg: '#e6eaf2',
    muted: '#a3aec2',
    danger: '#ff8a80',
    success: '#5fd68a',
  },
  // Pure black background: on OLED phones the pixels switch off, which saves battery.
  night: {
    bg: '#000000',
    surface: '#0b0b0b',
    raised: '#151515',
    border: '#2b2b2b',
    borderStrong: '#8a8a8a',
    fg: '#ededed',
    muted: '#a8a8a8',
    danger: '#ff8a80',
    success: '#5fd68a',
  },
}

export const DEFAULT_ACCENT = '#4f46e5'

export const ACCENT_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Blue', hex: '#1d4ed8' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Green', hex: '#15803d' },
  { name: 'Rose', hex: '#be123c' },
  { name: 'Amber', hex: '#b45309' },
]

const cssName = (k: string) => `--sm-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

/** Variables that depend on the chosen accent. Everything is checked for readable contrast. */
export function accentVars(accentInput: string, theme: ResolvedTheme): Record<string, string> {
  const t = BASE_TOKENS[theme]
  const { accent, onAccent } = buttonColors(normalizeHex(accentInput) ?? DEFAULT_ACCENT)
  // Hover moves away from the text colour, so contrast can only improve.
  const hover = mix(accent, onAccent === '#ffffff' ? '#000000' : '#ffffff', 0.14)
  return {
    '--sm-accent': accent,
    '--sm-accent-hover': hover,
    '--sm-on-accent': onAccent,
    '--sm-accent-subtle': mix(t.surface, accent, 0.14),
    '--sm-link': linkColor(accent, [t.bg, t.surface, t.raised]),
  }
}

export function baseVars(theme: ResolvedTheme): Record<string, string> {
  return Object.fromEntries(Object.entries(BASE_TOKENS[theme]).map(([k, v]) => [cssName(k), v]))
}

export function allVars(accent: string): Record<ResolvedTheme, Record<string, string>> {
  return Object.fromEntries(
    RESOLVED_THEMES.map((theme) => [theme, { ...baseVars(theme), ...accentVars(accent, theme) }]),
  ) as Record<ResolvedTheme, Record<string, string>>
}
