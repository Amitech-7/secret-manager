import { decrypt, encrypt, importAesKey } from './aead'
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './bytes'
import { CryptoError } from './errors'
import {
  DEFAULT_KDF_PARAMS,
  KDF_SALT_BYTES,
  deriveKeys,
  randomSalt,
  validateKdfParams,
  type DerivedKeys,
  type KdfParams,
} from './kdf'

/**
 * Encrypted export (.smvault): a JSON envelope around one AES-256-GCM blob. The key comes from
 * a separate export passphrase (Argon2id), not the master password, so a file stays readable
 * even after the master password changes. The envelope header (format, version, KDF
 * parameters, salt) is authenticated as AAD, so editing it makes decryption fail.
 */
export const EXPORT_FORMAT = 'smvault'
export const EXPORT_VERSION = 1
export const MIN_PASSPHRASE_LENGTH = 12
const MAX_FILE_CHARS = 24 * 1024 * 1024

export interface ExportItem {
  id: string
  type: string
  payload: unknown
}

interface ExportEnvelope {
  format: string
  version: number
  kdf: KdfParams
  salt: string
  data: string
}

function headerAad(kdf: KdfParams, saltB64: string): Uint8Array {
  return utf8(
    [
      EXPORT_FORMAT,
      EXPORT_VERSION,
      saltB64,
      kdf.alg,
      kdf.version,
      kdf.memoryKiB,
      kdf.iterations,
      kdf.parallelism,
    ].join('|'),
  )
}

/** Lets the web app run Argon2id in a Web Worker instead of freezing the page. */
export type KeyDeriver = (
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
) => Promise<DerivedKeys>

async function exportKey(passphrase: string, salt: Uint8Array, kdf: KdfParams, derive: KeyDeriver) {
  const { authKey, wrapKey } = await derive(passphrase, salt, kdf)
  authKey.fill(0)
  try {
    return await importAesKey(wrapKey)
  } finally {
    wrapKey.fill(0)
  }
}

export async function createExport(
  passphrase: string,
  items: ExportItem[],
  kdf: KdfParams = DEFAULT_KDF_PARAMS,
  derive: KeyDeriver = deriveKeys,
): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new CryptoError('WEAK_PASSPHRASE', 'Export passphrase is too short')
  }
  const salt = randomSalt()
  const saltB64 = toBase64Url(salt)
  const key = await exportKey(passphrase, salt, kdf, derive)
  const plaintext = utf8(JSON.stringify({ exportedAt: new Date().toISOString(), items }))
  const blob = await encrypt(key, plaintext, headerAad(kdf, saltB64))
  const envelope: ExportEnvelope = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    kdf,
    salt: saltB64,
    data: toBase64Url(blob),
  }
  return JSON.stringify(envelope)
}

function parseEnvelope(text: string): ExportEnvelope {
  if (text.length > MAX_FILE_CHARS) throw new CryptoError('INVALID_FORMAT', 'File too large')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Not a Secret Manager export')
  }
  const e = raw as Partial<ExportEnvelope> | null
  if (
    !e ||
    typeof e !== 'object' ||
    e.format !== EXPORT_FORMAT ||
    e.version !== EXPORT_VERSION ||
    typeof e.salt !== 'string' ||
    typeof e.data !== 'string' ||
    !e.kdf ||
    typeof e.kdf !== 'object'
  ) {
    throw new CryptoError('INVALID_FORMAT', 'Not a supported Secret Manager export')
  }
  return e as ExportEnvelope
}

export async function readExport(
  passphrase: string,
  text: string,
  derive: KeyDeriver = deriveKeys,
): Promise<ExportItem[]> {
  const envelope = parseEnvelope(text)
  // Validate before doing any expensive work: a crafted file must not exhaust memory or CPU.
  validateKdfParams(envelope.kdf)
  const salt = fromBase64Url(envelope.salt)
  if (salt.length !== KDF_SALT_BYTES) throw new CryptoError('INVALID_FORMAT', 'Bad salt')
  const key = await exportKey(passphrase, salt, envelope.kdf, derive)

  let plaintext: Uint8Array
  try {
    plaintext = await decrypt(
      key,
      fromBase64Url(envelope.data),
      headerAad(envelope.kdf, envelope.salt),
    )
  } catch (err) {
    if (err instanceof CryptoError && err.code === 'DECRYPT_FAILED') {
      throw new CryptoError('DECRYPT_FAILED', 'Wrong passphrase or damaged file')
    }
    throw err
  }

  let body: { items?: unknown }
  try {
    body = JSON.parse(fromUtf8(plaintext)) as { items?: unknown }
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Export contents are not valid')
  }
  if (!Array.isArray(body.items)) throw new CryptoError('INVALID_FORMAT', 'Export has no items')
  return body.items.map((entry: unknown) => {
    const item = entry as Partial<ExportItem> | null
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.type !== 'string' ||
      !('payload' in item)
    ) {
      throw new CryptoError('INVALID_FORMAT', 'Export contains a malformed item')
    }
    return { id: item.id, type: item.type, payload: item.payload }
  })
}
