import { DEFAULT_KDF_PARAMS, KDF_BOUNDS, type KdfParams } from '@sm/shared'
import { argon2id } from 'hash-wasm'
import { CryptoError } from './errors'

export { DEFAULT_KDF_PARAMS, KDF_BOUNDS }
export type { KdfParams }

/**
 * Key derivation: master password -> Argon2id -> HKDF -> two independent 32-byte keys.
 *
 *   authKey  is sent to the server (which stores only a hash of it) to prove knowledge
 *            of the password.
 *   wrapKey  never leaves the device; it wraps/unwraps the random vault key.
 *
 * HKDF with distinct labels makes the two keys independent: seeing authKey tells an
 * attacker nothing about wrapKey beyond what the Argon2id output itself would.
 */

export const KDF_SALT_BYTES = 16

export interface DerivedKeys {
  authKey: Uint8Array
  wrapKey: Uint8Array
}

const AUTH_INFO = 'secret-manager/v1/auth'
const WRAP_INFO = 'secret-manager/v1/wrap'

export function validateKdfParams(p: KdfParams): void {
  const ok =
    p.alg === 'argon2id' &&
    p.version === 19 &&
    Number.isInteger(p.memoryKiB) &&
    Number.isInteger(p.iterations) &&
    Number.isInteger(p.parallelism) &&
    p.memoryKiB >= KDF_BOUNDS.minMemoryKiB &&
    p.memoryKiB <= KDF_BOUNDS.maxMemoryKiB &&
    p.iterations >= KDF_BOUNDS.minIterations &&
    p.iterations <= KDF_BOUNDS.maxIterations &&
    p.parallelism >= KDF_BOUNDS.minParallelism &&
    p.parallelism <= KDF_BOUNDS.maxParallelism
  if (!ok) throw new CryptoError('INVALID_PARAMS', 'Invalid KDF parameters')
}

/**
 * Passwords are normalised to NFKC before encoding so the same typed password produces the
 * same keys on every keyboard and OS. This choice is permanent: changing it later would lock
 * existing users out.
 */
export function encodePassword(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC'))
}

/** HKDF-SHA256 with an empty salt and a purpose label, producing 32 bytes. */
export async function hkdfSha256(ikm: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function deriveKeys(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<DerivedKeys> {
  validateKdfParams(params)
  if (salt.length !== KDF_SALT_BYTES) throw new CryptoError('INVALID_PARAMS', 'Invalid salt length')
  if (password.length === 0) throw new CryptoError('INVALID_PARAMS', 'Empty password')

  const ikm = await argon2id({
    password: encodePassword(password),
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    hashLength: 32,
    outputType: 'binary',
  })

  try {
    const [authKey, wrapKey] = await Promise.all([
      hkdfSha256(ikm, AUTH_INFO),
      hkdfSha256(ikm, WRAP_INFO),
    ])
    return { authKey, wrapKey }
  } finally {
    ikm.fill(0)
  }
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KDF_SALT_BYTES))
}
