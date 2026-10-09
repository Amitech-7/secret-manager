import { useEffect, useRef } from 'react'
import { createIdleWatcher } from './idle'

/** Calls `onIdle` after 5 minutes without input, or a minute after the tab was hidden. */
export function useIdleLogout(onIdle: () => void): void {
  const latest = useRef(onIdle)
  latest.current = onIdle

  useEffect(() => {
    const watcher = createIdleWatcher({ onIdle: () => latest.current() })
    const activity = () => watcher.activity()
    const visibility = () => (document.hidden ? watcher.hidden() : watcher.visible())
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    for (const e of events) window.addEventListener(e, activity, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    return () => {
      watcher.stop()
      for (const e of events) window.removeEventListener(e, activity)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
}
