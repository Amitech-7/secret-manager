import { concat, utf8 } from './bytes'
import { CryptoError } from './errors'
import { hkdfSha256 } from './kdf'

/**
 * Recovery key: 32 random bytes plus a 2-byte checksum, shown once as 55 Crockford base32
 * characters in groups of five. Crockford's alphabet drops I, L, O and U, and decoding maps
 * O to 0 and I/L to 1, so a hand-copied key survives common transcription mistakes. The
 * checksum catches the rest before any decryption is attempted.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const KEY_BYTES = 32
const CHECKSUM_BYTES = 2
const ENCODED_LENGTH = 55
const CHECKSUM_LABEL = 'secret-manager/v1/recovery-checksum'
const AUTH_INFO = 'secret-manager/v1/recovery-auth'
const WRAP_INFO = 'secret-manager/v1/recovery-wrap'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
      value &= (1 << bits) - 1
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Uint8Array {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of text) {
    const index = ALPHABET.indexOf(ch)
    if (index < 0) throw new CryptoError('INVALID_RECOVERY_KEY', 'Invalid character')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
      value &= (1 << bits) - 1
    }
  }
  if (value !== 0) throw new CryptoError('INVALID_RECOVERY_KEY', 'Non-canonical encoding')
  return Uint8Array.from(out)
}

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    concat(utf8(CHECKSUM_LABEL), key) as BufferSource,
  )
  return new Uint8Array(digest).subarray(0, CHECKSUM_BYTES)
}

export function formatRecoveryKey(key: Uint8Array, check: Uint8Array): string {
  const encoded = base32Encode(concat(key, check))
  return encoded.match(/.{1,5}/g)!.join('-')
}

export async function generateRecoveryKey(): Promise<{ key: Uint8Array; display: string }> {
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  return { key, display: formatRecoveryKey(key, await checksum(key)) }
}

/** Accepts upper or lower case, spaces and hyphens, and the usual look-alike characters. */
export async function parseRecoveryKey(input: string): Promise<Uint8Array> {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (cleaned.length !== ENCODED_LENGTH) {
    throw new CryptoError('INVALID_RECOVERY_KEY', 'Recovery key has the wrong length')
  }
  const bytes = base32Decode(cleaned)
  const key = bytes.slice(0, KEY_BYTES)
  const given = bytes.subarray(KEY_BYTES)
  const expected = await checksum(key)
  if (given[0] !== expected[0] || given[1] !== expected[1]) {
    throw new CryptoError('INVALID_RECOVERY_KEY', 'Recovery key checksum does not match')
  }
  return key
}

/** The recovery key is already high-entropy, so HKDF is enough (no Argon2id needed). */
export async function deriveRecoveryKeys(
  recoveryKey: Uint8Array,
): Promise<{ recoveryAuth: Uint8Array; wrapKey: Uint8Array }> {
  if (recoveryKey.length !== KEY_BYTES) {
    throw new CryptoError('INVALID_RECOVERY_KEY', 'Recovery key must be 32 bytes')
  }
  const [recoveryAuth, wrapKey] = await Promise.all([
    hkdfSha256(recoveryKey, AUTH_INFO),
    hkdfSha256(recoveryKey, WRAP_INFO),
  ])
  return { recoveryAuth, wrapKey }
}
