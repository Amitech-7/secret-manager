import { describe, expect, it } from 'vitest'
import { formatConfig, median, verdict } from './stats'

describe('bench stats', () => {
  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNaN()
  })

  it('classifies timings', () => {
    expect(verdict(999)).toBe('ok')
    expect(verdict(1200)).toBe('slow')
    expect(verdict(2000)).toBe('too slow')
  })

  it('formats configs', () => {
    expect(formatConfig(65536, 3)).toBe('64 MiB, t=3')
  })
})
