/** Limits agreed in the build spec. Enforced by the API; mirrored in the UI for fast feedback. */
export const LIMITS = {
  maxItemsPerUser: 1000,
  maxItemBytes: 8 * 1024,
  /**
   * Rows per GET /vault/items page. Sized so a page of maximum-size items stays well under the
   * 4.5 MB function response cap on Vercel (see the bound test in index.test.ts).
   */
  vaultPageMaxItems: 300,
  usernameMin: 3,
  usernameMax: 32,
} as const

/** Lowercase letters, digits, dot, underscore, hyphen. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/

export const ERROR_CODES = [
  'VALIDATION',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'USERNAME_TAKEN',
  'CAPTCHA_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'VERSION_CONFLICT',
  'ITEM_TOO_LARGE',
  'QUOTA_EXCEEDED',
  'NOT_FOUND',
  'SERVICE_FULL',
  'INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ApiError {
  error: { code: ErrorCode; message: string; retryAfter?: number }
}

/** Kinds of encrypted vault item. Adding a kind needs a database migration (CHECK constraint). */
export const ITEM_TYPES = [
  'credential',
  'card',
  'member',
  'bank',
  'account_type',
  'account',
] as const

export type ItemType = (typeof ITEM_TYPES)[number]

/** Argon2id parameters as stored per user and exchanged with the server. */
export interface KdfParams {
  alg: 'argon2id'
  version: 19
  memoryKiB: number
  iterations: number
  parallelism: number
}

/**
 * Chosen from an on-device benchmark of a cheap 3-4 year old Android phone (Chrome):
 * 96 MiB t=3 took 525 ms and 128 MiB t=3 took 702 ms, so 108 MiB t=3 is roughly 0.6 s there.
 * Params are stored per user, so they can be raised later (upgrade on unlock).
 */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  alg: 'argon2id',
  version: 19,
  memoryKiB: 110592, // 108 MiB
  iterations: 3,
  parallelism: 1,
}

/**
 * Enforced by the client on every derivation (so a tampered server response cannot downgrade the
 * work factor) and by the server on registration (so a client cannot store a weak setting).
 */
export const KDF_BOUNDS = {
  minMemoryKiB: 19456, // 19 MiB, the lowest value commonly recommended for Argon2id
  maxMemoryKiB: 262144, // 256 MiB
  minIterations: 2,
  maxIterations: 10,
  minParallelism: 1,
  maxParallelism: 4,
} as const

/** Byte sizes of values on the wire (all sent as unpadded base64url). */
export const WIRE_BYTES = {
  authKey: 32,
  recoveryAuth: 32,
  kdfSalt: 16,
  /** version(1) + IV(12) + 32-byte vault key + 16-byte tag */
  wrappedVaultKey: 61,
  /** version(1) + IV(12) + tag(16): the smallest valid ciphertext */
  minCiphertext: 29,
  refreshToken: 32,
} as const

export const AUTH_LIMITS = {
  accessTokenSeconds: 15 * 60,
  refreshTokenSeconds: 30 * 24 * 60 * 60,
  maxSessionsPerUser: 10,
  maxSeedItems: 50,
  maxProfileBytes: 512,
} as const
