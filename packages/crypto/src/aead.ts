import { concat } from './bytes'
import { CryptoError } from './errors'

/**
 * Ciphertext layout: version(1) | iv(12) | AES-256-GCM ciphertext + 16-byte tag.
 * The version byte is also authenticated (it is prepended to the AAD), so it cannot be
 * flipped without detection. A fresh random 96-bit IV is used for every encryption.
 */
export const AEAD_VERSION = 1
const IV_BYTES = 12
export const AEAD_OVERHEAD = 1 + IV_BYTES + 16

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new CryptoError('INVALID_PARAMS', 'AES key must be 32 bytes')
  // Non-extractable: page script can use the key but cannot read its bytes back out.
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

function fullAad(aad: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(AEAD_VERSION), aad)
}

export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: fullAad(aad) as BufferSource,
        tagLength: 128,
      },
      key,
      plaintext as BufferSource,
    ),
  )
  return concat(Uint8Array.of(AEAD_VERSION), iv, sealed)
}

export async function decrypt(
  key: CryptoKey,
  blob: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (blob.length < AEAD_OVERHEAD) throw new CryptoError('INVALID_FORMAT', 'Ciphertext too short')
  if (blob[0] !== AEAD_VERSION) throw new CryptoError('INVALID_FORMAT', 'Unsupported version')
  const iv = blob.subarray(1, 1 + IV_BYTES)
  const sealed = blob.subarray(1 + IV_BYTES)
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as BufferSource,
          additionalData: fullAad(aad) as BufferSource,
          tagLength: 128,
        },
        key,
        sealed as BufferSource,
      ),
    )
  } catch {
    // Wrong key, wrong context or tampering: deliberately indistinguishable.
    throw new CryptoError('DECRYPT_FAILED', 'Decryption failed')
  }
}
