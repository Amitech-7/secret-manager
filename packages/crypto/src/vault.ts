import { LIMITS } from '@sm/shared'
import { decrypt, encrypt, importAesKey } from './aead'
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './bytes'
import { CryptoError } from './errors'

export const VAULT_KEY_BYTES = 32

/** A vault key is wrapped twice: once by the password-derived key, once by the recovery key. */
export type WrapKind = 'password' | 'recovery'
const WRAP_AAD: Record<WrapKind, string> = {
  password: 'secret-manager/v1/wrap/password',
  recovery: 'secret-manager/v1/wrap/recovery',
}

export function generateVaultKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(VAULT_KEY_BYTES))
}

export async function wrapVaultKey(
  vaultKey: Uint8Array,
  wrappingKey: CryptoKey,
  kind: WrapKind,
): Promise<Uint8Array> {
  if (vaultKey.length !== VAULT_KEY_BYTES) {
    throw new CryptoError('INVALID_PARAMS', 'Vault key must be 32 bytes')
  }
  return encrypt(wrappingKey, vaultKey, utf8(WRAP_AAD[kind]))
}

/** Returns a non-extractable key. The raw bytes are wiped before returning. */
export async function unwrapVaultKey(
  blob: Uint8Array,
  wrappingKey: CryptoKey,
  kind: WrapKind,
): Promise<CryptoKey> {
  const raw = await decrypt(wrappingKey, blob, utf8(WRAP_AAD[kind]))
  try {
    return await importAesKey(raw)
  } finally {
    raw.fill(0)
  }
}

/** Password change / recovery: re-wrap without ever exposing the raw vault key to callers. */
export async function rewrapVaultKey(
  blob: Uint8Array,
  oldKey: CryptoKey,
  oldKind: WrapKind,
  newKey: CryptoKey,
  newKind: WrapKind,
): Promise<Uint8Array> {
  const raw = await decrypt(oldKey, blob, utf8(WRAP_AAD[oldKind]))
  try {
    return await encrypt(newKey, raw, utf8(WRAP_AAD[newKind]))
  } finally {
    raw.fill(0)
  }
}

/**
 * Each item is bound to its own id and type. Swapping ciphertext between records, or moving a
 * password record into a card slot, fails authentication. The user id is not needed: every
 * user has a different vault key, so ciphertext cannot move between users either.
 */
export interface ItemContext {
  itemId: string
  type: string
}

export function itemAad(ctx: ItemContext): Uint8Array {
  if (!ctx.itemId || !ctx.type || ctx.itemId.includes('|') || ctx.type.includes('|')) {
    throw new CryptoError('INVALID_PARAMS', 'Invalid item context')
  }
  return utf8(`${ctx.itemId}|${ctx.type}`)
}

export async function encryptItem(
  vaultKey: CryptoKey,
  ctx: ItemContext,
  payload: unknown,
): Promise<string> {
  const blob = await encrypt(vaultKey, utf8(JSON.stringify(payload)), itemAad(ctx))
  if (blob.length > LIMITS.maxItemBytes) {
    throw new CryptoError('ITEM_TOO_LARGE', 'Item exceeds the size limit')
  }
  return toBase64Url(blob)
}

/** Returns parsed JSON typed as unknown; callers must validate the shape (Zod) before use. */
export async function decryptItem(
  vaultKey: CryptoKey,
  ctx: ItemContext,
  ciphertext: string,
): Promise<unknown> {
  const plaintext = await decrypt(vaultKey, fromBase64Url(ciphertext), itemAad(ctx))
  try {
    return JSON.parse(fromUtf8(plaintext)) as unknown
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Item payload is not valid JSON')
  }
}
