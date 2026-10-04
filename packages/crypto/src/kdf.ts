import { argon2id } from 'hash-wasm'

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

export interface KdfParams {
  alg: 'argon2id'
  version: 19
  memoryKiB: number
  iterations: number
  parallelism: number
}

export const KDF_SALT_BYTES = 16

/** Provisional until the on-device benchmark picks final values. */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  alg: 'argon2id',
  version: 19,
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
}

// Bounds are enforced on every derivation, including params read back from the server,
// so a tampered response cannot downgrade the work factor or exhaust device memory.
export const KDF_BOUNDS = {
  minMemoryKiB: 19456, // 19 MiB, the lowest value commonly recommended for Argon2id
  maxMemoryKiB: 262144, // 256 MiB
  minIterations: 2,
  maxIterations: 10,
  minParallelism: 1,
  maxParallelism: 4,
} as const

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
  if (!ok) throw new Error('Invalid KDF parameters')
}

/**
 * Passwords are normalised to NFKC before encoding so the same typed password produces the
 * same keys on every keyboard and OS. This choice is permanent: changing it later would lock
 * existing users out.
 */
export function encodePassword(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC'))
}

async function hkdf(ikm: Uint8Array, info: string): Promise<Uint8Array> {
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
  if (salt.length !== KDF_SALT_BYTES) throw new Error('Invalid salt length')
  if (password.length === 0) throw new Error('Empty password')

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
    const [authKey, wrapKey] = await Promise.all([hkdf(ikm, AUTH_INFO), hkdf(ikm, WRAP_INFO)])
    return { authKey, wrapKey }
  } finally {
    ikm.fill(0)
  }
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KDF_SALT_BYTES))
}
