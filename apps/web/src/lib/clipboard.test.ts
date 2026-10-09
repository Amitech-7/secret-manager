import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_CLEAR_MS, copySecret, type ClipboardLike } from './clipboard'

function fake(initial = '', canRead = true) {
  const state = { text: initial }
  const clip: ClipboardLike = {
    writeText: async (t) => {
      state.text = t
    },
    ...(canRead
      ? { readText: async () => state.text }
      : {
          readText: async () => {
            throw new Error('denied')
          },
        }),
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

  it('leaves the clipboard alone if the user copied something else meanwhile', async () => {
    const { state, clip } = fake()
    await copySecret('hunter2', clip)
    state.text = 'something else'
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1)
    expect(state.text).toBe('something else')
  })

  it('clears anyway when the clipboard cannot be read', async () => {
    const { state, clip } = fake('', false)
    await copySecret('hunter2', clip)
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 1)
    expect(state.text).toBe('')
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
