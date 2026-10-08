import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { applyPrefs } from './apply'
import { normalizeHex } from './colors'
import { DEFAULT_PREFS, loadPrefs, type Mode, type Prefs } from './prefs'
import type { ResolvedTheme } from './tokens'

interface ThemeApi {
  prefs: Prefs
  resolved: ResolvedTheme
  setMode(mode: Mode): void
  /** Ignores anything that is not a valid colour. */
  setAccent(hex: string): void
  reset(): void
}

const ThemeContext = createContext<ThemeApi | null>(null)

const safeStorage = (): Storage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(safeStorage()))
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const [resolved, setResolved] = useState<ResolvedTheme>('light')
  useEffect(() => {
    const storage = safeStorage()
    setResolved(
      applyPrefs(prefs, systemDark, {
        root: document.documentElement,
        themeColorMeta: document.querySelector('meta[name="theme-color"]'),
        ...(storage ? { storage } : {}),
      }),
    )
  }, [prefs, systemDark])

  const setMode = useCallback((mode: Mode) => setPrefs((p) => ({ ...p, mode })), [])
  const setAccent = useCallback((hex: string) => {
    const accent = normalizeHex(hex)
    if (accent) setPrefs((p) => ({ ...p, accent }))
  }, [])
  const reset = useCallback(() => setPrefs(DEFAULT_PREFS), [])

  const value = useMemo(
    () => ({ prefs, resolved, setMode, setAccent, reset }),
    [prefs, resolved, setMode, setAccent, reset],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
