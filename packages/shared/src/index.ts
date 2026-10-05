/** Limits agreed in the build spec. Enforced by the API; mirrored in the UI for fast feedback. */
export const LIMITS = {
  maxItemsPerUser: 1000,
  maxItemBytes: 8 * 1024,
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
  'note',
  'member',
  'bank',
  'account_type',
  'account',
] as const

export type ItemType = (typeof ITEM_TYPES)[number]
