import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_CLEAR_MS, copySecret, type ClipboardLike } from './clipboard'

function fake() {
  const state = { text: '', reads: 0 }
  const clip: ClipboardLike & { readText: () => Promise<string> } = {
    writeText: async (t) => {
      state.text = t
    },
    // Present only to prove the app never calls it.
    readText: async () => {
      state.reads++
      return state.text
    },
  }
  return { state, clip }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('copySecret', () => {
  it('copies, then clears after the delay', async () => {
    const { state, clip } = fake()
    expect(await copySecret('hunter2', clip)).toBe(true)
    expect(state.text).toBe('hunter2')
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1)
    expect(state.text).toBe('hunter2')
    await vi.advanceTimersByTimeAsync(2)
    expect(state.text).toBe('')
  })

  it('never reads the clipboard, so the browser never asks for permission to', async () => {
    const { state, clip } = fake()
    await copySecret('hunter2', clip)
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1)
    expect(state.reads).toBe(0)
  })

  it('a new copy restarts the countdown', async () => {
    const { state, clip } = fake()
    await copySecret('one', clip)
    await vi.advanceTimersByTimeAsync(20_000)
    await copySecret('two', clip)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(state.text).toBe('two')
    await vi.advanceTimersByTimeAsync(11_000)
    expect(state.text).toBe('')
  })

  it('stays quiet if the final clear is refused', async () => {
    let calls = 0
    const clip: ClipboardLike = {
      writeText: async () => {
        if (++calls > 1) throw new Error('not focused')
      },
    }
    await copySecret('x', clip)
    await expect(vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1)).resolves.not.toThrow()
    expect(calls).toBe(2)
  })

  it('reports failure when copying is refused or unavailable', async () => {
    const refusing: ClipboardLike = {
      writeText: async () => {
        throw new Error('no')
      },
    }
    expect(await copySecret('x', refusing)).toBe(false)
    expect(await copySecret('x', undefined)).toBe(false)
  })
})
