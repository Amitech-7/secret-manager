import { MODES, type Mode } from './prefs'
import { ACCENT_PRESETS } from './tokens'
import { useTheme } from './ThemeProvider'

const LABELS: Record<Mode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  night: 'Night',
}

export function ThemeControls() {
  const { prefs, setMode, setAccent, reset } = useTheme()
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <div
          className="grid grid-cols-4 gap-1 rounded-lg border border-border-strong p-1"
          role="radiogroup"
        >
          {MODES.map((mode) => (
            <label key={mode} className="cursor-pointer">
              <input
                type="radio"
                name="theme-mode"
                className="peer sr-only"
                checked={prefs.mode === mode}
                onChange={() => setMode(mode)}
              />
              <span className="block min-h-10 rounded-md px-1 py-2 text-center text-sm peer-checked:bg-accent peer-checked:text-on-accent peer-focus-visible:outline-2 peer-focus-visible:outline-link">
                {LABELS[mode]}
              </span>
            </label>
          ))}
        </div>
        {prefs.mode === 'night' ? (
          <p className="mt-1 text-xs text-muted">
            Night uses a pure black background, which saves battery on OLED screens.
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Accent colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              aria-label={p.name}
              aria-pressed={prefs.accent === p.hex}
              onClick={() => setAccent(p.hex)}
              style={{ backgroundColor: p.hex }}
              className="size-10 rounded-full border-2 border-border-strong aria-pressed:ring-2 aria-pressed:ring-link aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface"
            />
          ))}
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border-strong px-2 text-sm">
            Custom
            <input
              type="color"
              aria-label="Custom accent colour"
              value={prefs.accent}
              onChange={(e) => setAccent(e.target.value)}
              className="size-7 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          Button text switches between light and dark by itself, and links are tuned per theme, so
          any colour stays readable.
        </p>
      </fieldset>

      <button type="button" onClick={reset} className="min-h-10 text-sm underline">
        Reset to defaults
      </button>
    </div>
  )
}
