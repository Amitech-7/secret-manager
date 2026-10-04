import { describe, expect, it } from 'vitest'
import { AEAD_OVERHEAD, decrypt, encrypt, importAesKey } from './aead'
import { utf8 } from './bytes'

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i)
const AAD = utf8('item-1|credential')

describe('aead', () => {
  it('decrypts a blob produced by an independent implementation (Python cryptography)', async () => {
    const blob = hexToBytes(
      '016465666768696a6b6c6d6e6f3339ab4443cb37f257013acaf6471adf78e07539e81e960685acf8d2c95df218a320ff57ee1b0a5f2d2f',
    )
    const key = await importAesKey(KEY_BYTES)
    const plaintext = await decrypt(key, blob, AAD)
    expect(new TextDecoder().decode(plaintext)).toBe('{"u":"alice","p":"s3cret"}')
  })

  it('round-trips and adds exactly the documented overhead', async () => {
    const key = await importAesKey(KEY_BYTES)
    const pt = utf8('hello')
    const blob = await encrypt(key, pt, AAD)
    expect(blob.length).toBe(pt.length + AEAD_OVERHEAD)
    expect(await decrypt(key, blob, AAD)).toEqual(pt)
  })

  it('never reuses an IV or produces the same ciphertext twice', async () => {
    const key = await importAesKey(KEY_BYTES)
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const blob = await encrypt(key, utf8('same plaintext'), AAD)
      seen.add(Array.from(blob.subarray(1, 13)).join(','))
    }
    expect(seen.size).toBe(200)
  })

  it('fails on a wrong key', async () => {
    const key = await importAesKey(KEY_BYTES)
    const other = await importAesKey(Uint8Array.from({ length: 32 }, () => 7))
    const blob = await encrypt(key, utf8('x'), AAD)
    await expect(decrypt(other, blob, AAD)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' })
  })

  it('fails on wrong AAD', async () => {
    const key = await importAesKey(KEY_BYTES)
    const blob = await encrypt(key, utf8('x'), AAD)
    await expect(decrypt(key, blob, utf8('item-2|credential'))).rejects.toMatchObject({
      code: 'DECRYPT_FAILED',
    })
  })

  it('detects a flipped bit in every position of the blob', async () => {
    const key = await importAesKey(KEY_BYTES)
    const blob = await encrypt(key, utf8('tamper me'), AAD)
    for (let i = 0; i < blob.length; i++) {
      const bad = blob.slice()
      bad[i] = bad[i]! ^ 1
      await expect(decrypt(key, bad, AAD)).rejects.toThrow()
    }
  })

  it('rejects truncated blobs and unknown versions', async () => {
    const key = await importAesKey(KEY_BYTES)
    const blob = await encrypt(key, utf8('x'), AAD)
    await expect(decrypt(key, blob.subarray(0, 10), AAD)).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    const wrongVersion = blob.slice()
    wrongVersion[0] = 2
    await expect(decrypt(key, wrongVersion, AAD)).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
  })

  it('refuses keys that are not 32 bytes', async () => {
    await expect(importAesKey(new Uint8Array(16))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    })
  })
})
