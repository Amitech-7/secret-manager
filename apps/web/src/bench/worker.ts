import { deriveKeys, randomSalt } from '@sm/crypto'
import type { WorkerRequest, WorkerResponse } from './protocol'

// Minimal typing so we do not need the WebWorker lib alongside DOM.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void
  addEventListener(type: 'message', cb: (e: MessageEvent<WorkerRequest>) => void): void
}

ctx.addEventListener('message', (e) => {
  const { memoryKiB, iterations, runs } = e.data
  void (async () => {
    try {
      for (let index = 0; index < runs; index++) {
        const t0 = performance.now()
        await deriveKeys('benchmark-password', randomSalt(), {
          alg: 'argon2id',
          version: 19,
          memoryKiB,
          iterations,
          parallelism: 1,
        })
        ctx.postMessage({ type: 'run', index, ms: performance.now() - t0 })
      }
      ctx.postMessage({ type: 'done' })
    } catch (err) {
      ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })()
})
