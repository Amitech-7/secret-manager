import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleWatcher } from './idle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const watch = (onIdle = vi.fn()) => ({
  onIdle,
  w: createIdleWatcher({ idleMs: 300_000, hiddenMs: 60_000, onIdle }),
})

describe('idle watcher', () => {
  it('fires once after the idle time with no activity', () => {
    const { w, onIdle } = watch()
    vi.advanceTimersByTime(299_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600_000)
    w.visible()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('activity postpones it', () => {
    const { w, onIdle } = watch()
    vi.advanceTimersByTime(200_000)
    w.activity()
    vi.advanceTimersByTime(200_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(101_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('logs out on return after a long time in the background', () => {
    const { w, onIdle } = watch()
    vi.advanceTimersByTime(10_000)
    w.hidden()
    vi.setSystemTime(Date.now() + 61_000) // timers do not run while the tab sleeps
    w.visible()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('stays logged in after a short trip to the background', () => {
    const { w, onIdle } = watch()
    w.hidden()
    vi.advanceTimersByTime(30_000)
    w.visible()
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('does nothing after stop()', () => {
    const { w, onIdle } = watch()
    w.stop()
    vi.advanceTimersByTime(900_000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
