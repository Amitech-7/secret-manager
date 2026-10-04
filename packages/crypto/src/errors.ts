export type CryptoErrorCode =
  | 'INVALID_PARAMS'
  | 'INVALID_FORMAT'
  | 'DECRYPT_FAILED'
  | 'ITEM_TOO_LARGE'
  | 'INVALID_RECOVERY_KEY'
  | 'WEAK_PASSPHRASE'

/** Errors carry a stable code for the UI and never include secrets in their message. */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode

  constructor(code: CryptoErrorCode, message: string) {
    super(message)
    this.name = 'CryptoError'
    this.code = code
  }
}
