export interface WorkerRequest {
  memoryKiB: number
  iterations: number
  runs: number
}

export type WorkerResponse =
  { type: 'run'; index: number; ms: number } | { type: 'done' } | { type: 'error'; message: string }
