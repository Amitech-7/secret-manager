import { STORAGE_KEY, resolveMode, type Prefs } from './prefs'
import { BASE_TOKENS, RESOLVED_THEMES, accentVars, type ResolvedTheme } from './tokens'

export interface ThemeTarget {
  root: {
    setAttribute(name: string, value: string): void
    style: { setProperty(name: string, value: string): void }
  }
  themeColorMeta?: { setAttribute(name: string, value: string): void } | null
  storage?: Pick<Storage, 'setItem'>
}

/**
 * Applies the theme to the page and saves what the pre-paint script needs next time:
 * the accent variables for all three themes (so "System" can flip before first paint) and the
 * browser-bar colours. Only non-secret appearance data is stored.
 */
export function applyPrefs(prefs: Prefs, systemDark: boolean, target: ThemeTarget): ResolvedTheme {
  const resolved = resolveMode(prefs.mode, systemDark)
  target.root.setAttribute('data-theme', resolved)
  for (const [name, value] of Object.entries(accentVars(prefs.accent, resolved))) {
    target.root.style.setProperty(name, value)
  }
  target.themeColorMeta?.setAttribute('content', BASE_TOKENS[resolved].bg)
  try {
    target.storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: prefs.mode,
        accent: prefs.accent,
        vars: Object.fromEntries(RESOLVED_THEMES.map((t) => [t, accentVars(prefs.accent, t)])),
        themeColor: Object.fromEntries(RESOLVED_THEMES.map((t) => [t, BASE_TOKENS[t].bg])),
      }),
    )
  } catch {
    /* storage can be blocked (private mode); the theme still applies for this visit */
  }
  return resolved
}
