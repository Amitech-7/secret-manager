import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './bytes'
import {
  EXPORT_FORMAT,
  createExport,
  readExport,
  type ExportItem,
  type KeyDeriver,
} from './exportfile'
import { KDF_BOUNDS, deriveKeys, type KdfParams } from './kdf'

const FAST: KdfParams = {
  alg: 'argon2id',
  version: 19,
  memoryKiB: KDF_BOUNDS.minMemoryKiB,
  iterations: 2,
  parallelism: 1,
}
const PASS = 'a long export passphrase'
const ITEMS: ExportItem[] = [
  { id: 'i1', type: 'credential', payload: { username: 'alice', password: 'p4ss' } },
  { id: 'i2', type: 'card', payload: { number: '4111111111111111', cvv: '123' } },
]

describe('export file', () => {
  it('round-trips items', async () => {
    const file = await createExport(PASS, ITEMS, FAST)
    expect(await readExport(PASS, file)).toEqual(ITEMS)
  })

  it('contains no plaintext and identifies its format', async () => {
    const file = await createExport(PASS, ITEMS, FAST)
    expect(file).not.toContain('alice')
    expect(file).not.toContain('4111111111111111')
    expect(JSON.parse(file)).toMatchObject({ format: EXPORT_FORMAT, version: 1, kdf: FAST })
  })

  it('uses a custom key deriver when given one (the web app passes a worker)', async () => {
    let calls = 0
    const derive: KeyDeriver = (pw, salt, params) => {
      calls++
      return deriveKeys(pw, salt, params)
    }
    const file = await createExport(PASS, ITEMS, FAST, derive)
    expect(await readExport(PASS, file, derive)).toEqual(ITEMS)
    expect(calls).toBe(2)
  })

  it('differs every time (fresh salt and IV)', async () => {
    const a = await createExport(PASS, ITEMS, FAST)
    const b = await createExport(PASS, ITEMS, FAST)
    expect(a).not.toBe(b)
  })

  it('fails cleanly with the wrong passphrase', async () => {
    const file = await createExport(PASS, ITEMS, FAST)
    await expect(readExport('some other passphrase', file)).rejects.toMatchObject({
      code: 'DECRYPT_FAILED',
    })
  })

  it('rejects short passphrases when exporting', async () => {
    await expect(createExport('short', ITEMS, FAST)).rejects.toMatchObject({
      code: 'WEAK_PASSPHRASE',
    })
  })

  it('detects tampering with the data, the salt and the KDF parameters', async () => {
    const file = JSON.parse(await createExport(PASS, ITEMS, FAST)) as {
      data: string
      salt: string
      kdf: KdfParams
    }

    const data = fromBase64Url(file.data)
    data[data.length - 1] = data[data.length - 1]! ^ 1
    await expect(
      readExport(PASS, JSON.stringify({ ...file, data: toBase64Url(data) })),
    ).rejects.toThrow()

    const salt = fromBase64Url(file.salt)
    salt[0] = salt[0]! ^ 1
    await expect(
      readExport(PASS, JSON.stringify({ ...file, salt: toBase64Url(salt) })),
    ).rejects.toThrow()

    await expect(
      readExport(PASS, JSON.stringify({ ...file, kdf: { ...file.kdf, iterations: 3 } })),
    ).rejects.toThrow()
  })

  it('refuses hostile KDF parameters before doing any expensive work', async () => {
    const file = JSON.parse(await createExport(PASS, ITEMS, FAST)) as { kdf: KdfParams }
    const started = Date.now()
    await expect(
      readExport(
        PASS,
        JSON.stringify({ ...file, kdf: { ...file.kdf, memoryKiB: 4 * 1024 * 1024 } }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('rejects files that are not exports, or have an unknown version', async () => {
    await expect(readExport(PASS, 'not json')).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
    await expect(readExport(PASS, '{"hello":1}')).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
    const file = JSON.parse(await createExport(PASS, ITEMS, FAST)) as object
    await expect(readExport(PASS, JSON.stringify({ ...file, version: 2 }))).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
  })

  it('handles an empty vault and a full-size vault', async () => {
    expect(await readExport(PASS, await createExport(PASS, [], FAST))).toEqual([])
    const many: ExportItem[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      type: 'credential',
      payload: { username: `user${i}`, password: 'x'.repeat(100) },
    }))
    expect(await readExport(PASS, await createExport(PASS, many, FAST))).toEqual(many)
  })
})
