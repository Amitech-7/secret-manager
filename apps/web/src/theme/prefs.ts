import { normalizeHex } from './colors'
import { DEFAULT_ACCENT, type ResolvedTheme } from './tokens'

export const MODES = ['system', 'light', 'dark', 'night'] as const
export type Mode = (typeof MODES)[number]

export interface Prefs {
  mode: Mode
  /** A #rrggbb colour. Only the accent is customisable, so every screen stays readable. */
  accent: string
}

export const DEFAULT_PREFS: Prefs = { mode: 'system', accent: DEFAULT_ACCENT }
export const STORAGE_KEY = 'sm-theme'

/** Anything unexpected (corrupt storage, an old version) quietly falls back to the defaults. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const data = JSON.parse(raw) as Partial<Prefs>
    const mode = MODES.includes(data.mode as Mode) ? (data.mode as Mode) : DEFAULT_PREFS.mode
    const accent =
      typeof data.accent === 'string'
        ? (normalizeHex(data.accent) ?? DEFAULT_ACCENT)
        : DEFAULT_ACCENT
    return { mode, accent }
  } catch {
    return DEFAULT_PREFS
  }
}

export function resolveMode(mode: Mode, systemDark: boolean): ResolvedTheme {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

export function loadPrefs(storage: Pick<Storage, 'getItem'> | undefined): Prefs {
  try {
    return parsePrefs(storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return DEFAULT_PREFS
  }
}
