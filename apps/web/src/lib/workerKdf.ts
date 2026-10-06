import type { KdfRunner } from '@sm/client'

type Reply =
  | { ok: true; authKey: Uint8Array; wrapKey: Uint8Array }
  | { ok: false; message: string; code?: string }

/** One short-lived worker per derivation, so the memory (up to 108 MiB) is released straight after. */
export const workerKdf: KdfRunner = (password, salt, params) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' })
    const fail = (message: string, code?: string) => {
      worker.terminate()
      reject(Object.assign(new Error(message), { code }))
    }
    worker.onmessage = (e: MessageEvent<Reply>) => {
      worker.terminate()
      if (e.data.ok) resolve({ authKey: e.data.authKey, wrapKey: e.data.wrapKey })
      else reject(Object.assign(new Error(e.data.message), { code: e.data.code }))
    }
    worker.onerror = () => fail('Key derivation failed')
    worker.postMessage({ password, salt, params })
  })
