export const IDLE_LOGOUT_MS = 5 * 60_000
export const HIDDEN_LOGOUT_MS = 60_000

export interface IdleWatcher {
  /** Call on any sign of life (key, tap, scroll). Cheap to call often. */
  activity(): void
  /** The tab or app went to the background. */
  hidden(): void
  /** The tab or app came back. Logs out if it was away too long. */
  visible(): void
  stop(): void
}

/**
 * Fires `onIdle` once when there has been no activity for `idleMs`, or when the page was hidden
 * for `hiddenMs` or more. Background tabs throttle timers, so on return we compare wall-clock
 * times instead of trusting that a timer ran on time.
 */
export function createIdleWatcher(options: {
  idleMs?: number
  hiddenMs?: number
  onIdle: () => void
}): IdleWatcher {
  const idleMs = options.idleMs ?? IDLE_LOGOUT_MS
  const hiddenMs = options.hiddenMs ?? HIDDEN_LOGOUT_MS
  let last = Date.now()
  let hiddenAt: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false

  const stop = () => {
    done = true
    clearTimeout(timer)
  }
  const fire = () => {
    if (done) return
    stop()
    options.onIdle()
  }
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(
      () => {
        if (Date.now() - last >= idleMs) fire()
        else arm()
      },
      Math.max(0, idleMs - (Date.now() - last)),
    )
  }
  arm()

  return {
    activity() {
      const now = Date.now()
      if (done || now - last < 1000) return
      last = now
      arm()
    },
    hidden() {
      if (hiddenAt === null) hiddenAt = Date.now()
    },
    visible() {
      if (done || hiddenAt === null) return
      const away = Date.now() - hiddenAt
      hiddenAt = null
      if (away >= hiddenMs || Date.now() - last >= idleMs) fire()
    },
    stop,
  }
}
