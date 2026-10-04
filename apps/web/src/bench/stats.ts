export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const lo = sorted[mid - 1] ?? NaN
  const hi = sorted[mid] ?? NaN
  return sorted.length % 2 ? hi : (lo + hi) / 2
}

export type Verdict = 'ok' | 'slow' | 'too slow'

/** Target is about one second per unlock on the weakest phone you will use. */
export function verdict(medianMs: number): Verdict {
  if (medianMs <= 1000) return 'ok'
  if (medianMs <= 1500) return 'slow'
  return 'too slow'
}

export function formatConfig(memoryKiB: number, iterations: number): string {
  return `${memoryKiB / 1024} MiB, t=${iterations}`
}
