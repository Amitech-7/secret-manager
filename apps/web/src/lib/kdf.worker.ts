import { CryptoError, deriveKeys, type KdfParams } from '@sm/crypto'

// Argon2id is slow by design, so it runs here instead of freezing the page.
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void
}

ctx.addEventListener(
  'message',
  (e: MessageEvent<{ password: string; salt: Uint8Array; params: KdfParams }>) => {
    const { password, salt, params } = e.data
    void deriveKeys(password, salt, params).then(
      (keys) =>
        ctx.postMessage({ ok: true, authKey: keys.authKey, wrapKey: keys.wrapKey }, [
          keys.authKey.buffer as ArrayBuffer,
          keys.wrapKey.buffer as ArrayBuffer,
        ]),
      (err: unknown) =>
        ctx.postMessage({
          ok: false,
          message: err instanceof Error ? err.message : 'Key derivation failed',
          code: err instanceof CryptoError ? err.code : undefined,
        }),
    )
  },
)
