import { LIMITS } from '@sm/shared'
import { describe, expect, it } from 'vitest'
import { importAesKey } from './aead'
import { fromBase64Url, toBase64Url } from './bytes'
import {
  decryptItem,
  encryptItem,
  generateVaultKey,
  rewrapVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
} from './vault'

const pwKey = () => importAesKey(crypto.getRandomValues(new Uint8Array(32)))
const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))

describe('vault key wrapping', () => {
  it('wraps and unwraps with the password key and with the recovery key', async () => {
    const vk = generateVaultKey()
    const pw = await pwKey()
    const rec = await pwKey()
    const wrappedPw = await wrapVaultKey(vk, pw, 'password')
    const wrappedRec = await wrapVaultKey(vk, rec, 'recovery')

    const viaPw = await unwrapVaultKey(wrappedPw, pw, 'password')
    const viaRec = await unwrapVaultKey(wrappedRec, rec, 'recovery')
    const ctx = { itemId: 'i1', type: 'credential' }
    const sealed = await encryptItem(viaPw, ctx, { hello: 'world' })
    expect(await decryptItem(viaRec, ctx, sealed)).toEqual({ hello: 'world' })
  })

  it('keeps the two wraps separate: a blob only opens under its own kind', async () => {
    const vk = generateVaultKey()
    const key = await pwKey()
    const wrapped = await wrapVaultKey(vk, key, 'password')
    await expect(unwrapVaultKey(wrapped, key, 'recovery')).rejects.toMatchObject({
      code: 'DECRYPT_FAILED',
    })
  })

  it('fails with the wrong wrapping key', async () => {
    const wrapped = await wrapVaultKey(generateVaultKey(), await pwKey(), 'password')
    await expect(unwrapVaultKey(wrapped, await pwKey(), 'password')).rejects.toThrow()
  })

  it('unwrapped vault keys are not extractable', async () => {
    const key = await pwKey()
    const vk = await unwrapVaultKey(
      await wrapVaultKey(generateVaultKey(), key, 'password'),
      key,
      'password',
    )
    await expect(crypto.subtle.exportKey('raw', vk)).rejects.toThrow()
  })

  it('re-wraps for a password change without changing what the vault key decrypts', async () => {
    const vk = generateVaultKey()
    const oldKey = await pwKey()
    const newKey = await pwKey()
    const oldWrap = await wrapVaultKey(vk, oldKey, 'password')
    const ctx = { itemId: 'i1', type: 'card' }
    const sealed = await encryptItem(await unwrapVaultKey(oldWrap, oldKey, 'password'), ctx, 42)

    const newWrap = await rewrapVaultKey(oldWrap, oldKey, 'password', newKey, 'password')
    const reopened = await unwrapVaultKey(newWrap, newKey, 'password')
    expect(await decryptItem(reopened, ctx, sealed)).toBe(42)
    await expect(unwrapVaultKey(newWrap, oldKey, 'password')).rejects.toThrow()
  })

  it('generates distinct 32-byte vault keys', () => {
    const a = generateVaultKey()
    const b = generateVaultKey()
    expect(a).toHaveLength(32)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('item encryption', () => {
  const setup = async () => {
    const key = await pwKey()
    const vk = await unwrapVaultKey(
      await wrapVaultKey(generateVaultKey(), key, 'password'),
      key,
      'password',
    )
    return vk
  }

  it('round-trips structured payloads including unicode', async () => {
    const vk = await setup()
    const ctx = { itemId: 'abc', type: 'credential' }
    const payload = {
      username: 'alice',
      password: 'p\u00e4ss \u0928\u092e\u0938\u094d\u0924\u0947',
      nested: [1, 2, { a: null }],
    }
    expect(await decryptItem(vk, ctx, await encryptItem(vk, ctx, payload))).toEqual(payload)
  })

  it('produces different ciphertext for identical payloads', async () => {
    const vk = await setup()
    const ctx = { itemId: 'abc', type: 'credential' }
    const a = await encryptItem(vk, ctx, { x: 1 })
    const b = await encryptItem(vk, ctx, { x: 1 })
    expect(a).not.toBe(b)
  })

  it('rejects ciphertext moved to another item id or another type', async () => {
    const vk = await setup()
    const sealed = await encryptItem(vk, { itemId: 'one', type: 'credential' }, { s: 'secret' })
    await expect(decryptItem(vk, { itemId: 'two', type: 'credential' }, sealed)).rejects.toThrow()
    await expect(decryptItem(vk, { itemId: 'one', type: 'card' }, sealed)).rejects.toThrow()
  })

  it('rejects ciphertext from another vault key', async () => {
    const ctx = { itemId: 'one', type: 'credential' }
    const sealed = await encryptItem(await setup(), ctx, 'x')
    await expect(decryptItem(await setup(), ctx, sealed)).rejects.toThrow()
  })

  it('detects tampering with the stored string', async () => {
    const vk = await setup()
    const ctx = { itemId: 'one', type: 'credential' }
    const bytes = fromBase64Url(await encryptItem(vk, ctx, { s: 'secret' }))
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
    await expect(decryptItem(vk, ctx, toBase64Url(bytes))).rejects.toThrow()
  })

  it('enforces the item size limit and accepts a payload just under it', async () => {
    const vk = await setup()
    const ctx = { itemId: 'big', type: 'note' }
    await expect(encryptItem(vk, ctx, 'x'.repeat(LIMITS.maxItemBytes))).rejects.toMatchObject({
      code: 'ITEM_TOO_LARGE',
    })
    const ok = await encryptItem(vk, ctx, 'x'.repeat(LIMITS.maxItemBytes - 100))
    expect(fromBase64Url(ok).length).toBeLessThanOrEqual(LIMITS.maxItemBytes)
  })

  it('rejects ambiguous contexts', async () => {
    const vk = await setup()
    await expect(encryptItem(vk, { itemId: 'a|b', type: 'c' }, 1)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    })
    await expect(encryptItem(vk, { itemId: '', type: 'c' }, 1)).rejects.toThrow()
  })

  it('decrypts an item sealed by an independent implementation (Python cryptography)', async () => {
    const key = await importAesKey(Uint8Array.from({ length: 32 }, (_, i) => i))
    const blob = hexToBytes(
      '016465666768696a6b6c6d6e6f3339ab4443cb37f257013acaf6471adf78e07539e81e960685acf8d2c95df218a320ff57ee1b0a5f2d2f',
    )
    expect(
      await decryptItem(key, { itemId: 'item-1', type: 'credential' }, toBase64Url(blob)),
    ).toEqual({ u: 'alice', p: 's3cret' })
  })
})
