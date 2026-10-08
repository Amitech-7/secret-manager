import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError } from '../errors'

export const sha256 = (data: Uint8Array | string): Buffer =>
  createHash('sha256').update(data).digest()

/** Constant-time equality for two byte strings of any length. */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

export function newRefreshToken(): { token: string; hash: Buffer } {
  const raw = randomBytes(32)
  return { token: b64u(raw), hash: sha256(raw) }
}

// --- Access tokens: HS256 JWT, implemented directly so the algorithm is pinned, the clock is
// --- injectable, and there is no ambiguity about what is verified.

export interface AccessClaims {
  sub: string
  sid: string
  iat: number
  exp: number
}

const HEADER = b64u(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))

function mac(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest()
}

export function signAccessToken(
  secret: string,
  claims: { sub: string; sid: string },
  nowSec: number,
  ttlSec: number,
): string {
  const payload = b64u(
    Buffer.from(
      JSON.stringify({ ...claims, iat: nowSec, exp: nowSec + ttlSec } satisfies AccessClaims),
    ),
  )
  const input = `${HEADER}.${payload}`
  return `${input}.${b64u(mac(secret, input))}`
}

export function verifyAccessToken(secret: string, token: string, nowSec: number): AccessClaims {
  const invalid = () => new AppError('UNAUTHENTICATED', 'Invalid token')
  const parts = token.split('.')
  if (parts.length !== 3) throw invalid()
  const [header, payload, signature] = parts as [string, string, string]
  // Only our exact header is accepted. This rejects alg "none" and any algorithm confusion.
  if (header !== HEADER) throw invalid()
  const expected = mac(secret, `${header}.${payload}`)
  if (!safeEqual(expected, Buffer.from(signature, 'base64url'))) throw invalid()

  let claims: Partial<AccessClaims>
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AccessClaims>
  } catch {
    throw invalid()
  }
  if (
    typeof claims.sub !== 'string' ||
    typeof claims.sid !== 'string' ||
    typeof claims.exp !== 'number' ||
    typeof claims.iat !== 'number'
  ) {
    throw invalid()
  }
  if (claims.exp <= nowSec) throw new AppError('TOKEN_EXPIRED', 'Token expired')
  return claims as AccessClaims
}

// --- Purpose tokens (e.g. password recovery). Each purpose has its own derived signing key, so a
// --- token for one purpose can never be accepted as another, or as an access token.

const subkey = (secret: string, purpose: string): string =>
  createHmac('sha256', secret).update(`subkey:${purpose}`).digest('hex')

export function signPurposeToken(
  secret: string,
  purpose: string,
  claims: Record<string, string>,
  nowSec: number,
  ttlSec: number,
): string {
  const payload = b64u(
    Buffer.from(JSON.stringify({ ...claims, pur: purpose, iat: nowSec, exp: nowSec + ttlSec })),
  )
  const input = `${HEADER}.${payload}`
  return `${input}.${b64u(mac(subkey(secret, purpose), input))}`
}

export function verifyPurposeToken(
  secret: string,
  purpose: string,
  token: string,
  nowSec: number,
): Record<string, string> {
  const invalid = () => new AppError('UNAUTHENTICATED', 'Invalid token')
  const parts = token.split('.')
  if (parts.length !== 3) throw invalid()
  const [header, payload, signature] = parts as [string, string, string]
  if (header !== HEADER) throw invalid()
  const expected = mac(subkey(secret, purpose), `${header}.${payload}`)
  if (!safeEqual(expected, Buffer.from(signature, 'base64url'))) throw invalid()
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
  } catch {
    throw invalid()
  }
  if (claims.pur !== purpose || typeof claims.exp !== 'number') throw invalid()
  if (claims.exp <= nowSec) throw new AppError('TOKEN_EXPIRED', 'Token expired')
  return claims as Record<string, string>
}
