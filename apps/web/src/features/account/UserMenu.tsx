import { useEffect, useRef, useState } from 'react'
import { ThemeControls } from '../../theme/ThemeControls'
import { MENU_SCREENS, initialOf, type Screen } from './menuModel'

/** The account button in the header: my vault, backup, settings, theme and log out. */
export function UserMenu(props: {
  username: string
  screen: Screen
  onNavigate: (screen: Screen) => void
  onLogOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const itemClass =
    'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-raised'

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${props.username}`}
        onClick={() => setOpen((v) => !v)}
        className="flex size-11 items-center justify-center rounded-full bg-accent text-base font-semibold text-on-accent"
      >
        {initialOf(props.username)}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-1 rounded-xl border border-border bg-surface p-2 shadow-lg"
        >
          <p className="truncate px-3 py-2 text-xs text-muted">Signed in as {props.username}</p>
          {MENU_SCREENS.map((m) => (
            <button
              key={m.screen}
              role="menuitem"
              type="button"
              aria-current={props.screen === m.screen ? 'page' : undefined}
              className={itemClass + (props.screen === m.screen ? ' font-semibold' : '')}
              onClick={() => {
                setOpen(false)
                props.onNavigate(m.screen)
              }}
            >
              {m.label}
            </button>
          ))}
          <details className="rounded-lg">
            <summary className={itemClass + ' cursor-pointer list-none'}>Theme</summary>
            <div className="p-3">
              <ThemeControls />
            </div>
          </details>
          <button
            role="menuitem"
            type="button"
            className={itemClass + ' text-danger'}
            onClick={() => {
              setOpen(false)
              props.onLogOut()
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  )
}
