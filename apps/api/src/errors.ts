import type { ApiError, ErrorCode } from '@sm/shared'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  CAPTCHA_FAILED: 403,
  QUOTA_EXCEEDED: 403,
  NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  VERSION_CONFLICT: 409,
  ITEM_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_FULL: 503,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryAfter?: number
  readonly status: ContentfulStatusCode

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryAfter?: number; status?: ContentfulStatusCode } = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = options.status ?? STATUS[code]
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter
  }
}

export function errorBody(code: ErrorCode, message: string, retryAfter?: number): ApiError {
  return { error: { code, message, ...(retryAfter !== undefined ? { retryAfter } : {}) } }
}

/** One place turns every failure into the documented error shape. Nothing internal leaks. */
export function handleError(err: unknown, c: Context): Response {
  if (err instanceof AppError) {
    if (err.retryAfter !== undefined) c.header('Retry-After', String(err.retryAfter))
    return c.json(errorBody(err.code, err.message, err.retryAfter), err.status)
  }
  if (err instanceof ZodError) {
    // Field names only. Echoing submitted values could reflect secrets back.
    const fields = [...new Set(err.issues.map((i) => i.path.join('.') || '(body)'))]
    return c.json(errorBody('VALIDATION', `Invalid request: ${fields.join(', ')}`), 400)
  }
  // Log the error class only: driver errors can contain hosts, usernames or SQL.
  console.error('Unhandled error:', err instanceof Error ? err.name : typeof err)
  return c.json(errorBody('INTERNAL', 'Internal error'), 500)
}
