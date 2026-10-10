import { createApp } from '@sm/api/app'
import { harness, type Harness } from '@sm/api/testkit'
import { createExport, type KdfParams } from '@sm/crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApiClient, type ApiClient } from './api'
import { prepareRegistration } from './auth'
import { applyImport, exportFileName, exportVault, IMPORT_CHUNK, previewImport } from './backup'
import { ImportError } from './importPlan'
import {
  createItem,
  deleteItem,
  findReferences,
  loadVault,
  updateItem,
  type VaultItem,
} from './vault'

const FAST: KdfParams = {
  alg: 'argon2id',
  version: 19,
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
}
const PASSWORD = 'violet tractor ceiling marathon pebble'
const BACKUP_PASS = 'a separate backup passphrase'

let h: Harness
let app: ReturnType<typeof createApp>
let nextIp = 1
const freshIp = () => `10.9.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`

function clientAt(ip = freshIp()): ApiClient {
  const doFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    headers.set('x-real-ip', ip)
    return app.request(url.pathname + url.search, { ...init, headers })
  }
  return createApiClient({ baseUrl: 'http://localhost', fetch: doFetch })
}

let counter = 0
async function signUp() {
  const api = clientAt()
  const prepared = await prepareRegistration({
    api,
    username: `backupuser${++counter}`,
    password: PASSWORD,
    kdfParams: FAST,
  })
  return { api, session: await prepared.submit('captcha-ok') }
}

type Of<T extends VaultItem['type']> = Extract<VaultItem, { type: T }>
const of = <T extends VaultItem['type']>(items: VaultItem[], type: T, name?: string) =>
  items.filter(
    (i): i is Of<T> =>
      i.type === type && (name === undefined || (i.payload as { name?: string }).name === name),
  )

/** A vault with one credential and one card on top of the starter lists. */
async function populated() {
  const { api, session } = await signUp()
  const { items } = await loadVault(session, { api })
  const self = of(items, 'member')[0]!
  const google = of(items, 'account', 'Google')[0]!
  const bank = of(items, 'bank')[0]!
  const a = await createItem(session, { api }, 'credential', {
    memberId: self.id,
    accountId: google.id,
    username: 'arjun',
    password: 'first-password',
    hint: 'pet',
  })
  const b = await createItem(a.session, { api }, 'card', {
    memberId: self.id,
    bankId: bank.id,
    cardName: 'Travel',
    nameOnCard: 'ARJUN',
    number: '4111 1111 1111 1111',
    expiryDate: '2030-09',
    cvv: '123',
  })
  return {
    api,
    session: b.session,
    credential: a.item as Of<'credential'>,
    card: b.item as Of<'card'>,
  }
}

const opts = (api: ApiClient) => ({ api, kdf: undefined })

beforeAll(async () => {
  h = await harness()
  app = createApp(h.deps)
})
afterAll(async () => h.client.close())

describe('export', () => {
  it('produces an opaque file containing every readable item', async () => {
    const { api, session } = await populated()
    const out = await exportVault(session, opts(api), BACKUP_PASS, FAST)
    expect(out.itemCount).toBe(14)
    expect(out.unreadable).toEqual([])
    for (const secret of ['first-password', '4111', 'arjun', 'Travel', 'Self']) {
      expect(out.file).not.toContain(secret)
    }
    expect(out.fileName).toMatch(/^secret-manager-\d{4}-\d{2}-\d{2}\.smvault$/)
  })

  it('rejects a short passphrase', async () => {
    const { api, session } = await populated()
    await expect(exportVault(session, opts(api), 'short', FAST)).rejects.toMatchObject({
      code: 'WEAK_PASSPHRASE',
    })
  })

  it('reports items it could not open instead of hiding them', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const [a, b] = of(items, 'account')
    await h.client.exec(`
      update vault_items set ciphertext = case id
        when '${a!.id}' then (select ciphertext from vault_items where id = '${b!.id}')
        when '${b!.id}' then (select ciphertext from vault_items where id = '${a!.id}') end
      where id in ('${a!.id}', '${b!.id}')`)
    const out = await exportVault(session, opts(api), BACKUP_PASS, FAST)
    expect(out.itemCount).toBe(10)
    expect(out.unreadable.map((u) => u.id).sort()).toEqual([a!.id, b!.id].sort())
  })

  it('names the file by date', () => {
    expect(exportFileName(new Date('2026-10-10T23:59:00Z'))).toBe(
      'secret-manager-2026-10-10.smvault',
    )
  })
})

describe('import into a different account', () => {
  it('merges the starter lists, adds the items, and keeps every link intact', async () => {
    const source = await populated()
    const { file } = await exportVault(source.session, opts(source.api), BACKUP_PASS, FAST)

    const target = await signUp()
    const { plan } = await previewImport(target.session, opts(target.api), BACKUP_PASS, file)
    expect(plan.merged).toBe(12) // every starter item matched by name
    expect(plan.creates.map((c) => c.type).sort()).toEqual(['card', 'credential'])
    expect(plan.unchanged).toBe(0)
    expect(plan.invalid).toEqual([])

    const done = await applyImport(target.session, opts(target.api), plan, { overwrite: false })
    expect(done).toMatchObject({ created: 2, updated: 0 })

    const after = await loadVault(done.session, { api: target.api })
    expect(after.unreadable).toEqual([])
    expect(after.items).toHaveLength(14)
    const cred = of(after.items, 'credential')[0]!
    const mine = of(after.items, 'member')[0]!
    expect(cred.payload).toMatchObject({
      username: 'arjun',
      password: 'first-password',
      memberId: mine.id,
    })
    expect(of(after.items, 'account', 'Google')[0]!.id).toBe(cred.payload.accountId)
    expect(findReferences(after.items, mine)).toHaveLength(2)
    // New ids, so the two accounts' rows can never collide.
    expect(cred.id).not.toBe(source.credential.id)
  })

  it('is safe to repeat: the second run changes nothing', async () => {
    const source = await populated()
    const { file } = await exportVault(source.session, opts(source.api), BACKUP_PASS, FAST)
    const target = await signUp()
    const first = await previewImport(target.session, opts(target.api), BACKUP_PASS, file)
    const applied = await applyImport(first.session, opts(target.api), first.plan, {
      overwrite: false,
    })

    const again = await previewImport(applied.session, opts(target.api), BACKUP_PASS, file)
    expect(again.plan.creates).toEqual([])
    expect(again.plan.updates).toEqual([])
    expect(again.plan.merged).toBe(12) // starter lists, matched by name
    expect(again.plan.unchanged).toBe(2) // the credential and the card
    expect((await loadVault(again.session, { api: target.api })).items).toHaveLength(14)
  })
})

describe('restoring into the same account', () => {
  it('puts back only what was deleted', async () => {
    const { api, session, credential } = await populated()
    const { file } = await exportVault(session, opts(api), BACKUP_PASS, FAST)
    const { session: afterDelete } = await deleteItem(session, { api }, credential.id)

    const preview = await previewImport(afterDelete, opts(api), BACKUP_PASS, file)
    expect(preview.plan.creates.map((c) => c.type)).toEqual(['credential'])
    expect(preview.plan.unchanged).toBe(13)
    const done = await applyImport(preview.session, opts(api), preview.plan, { overwrite: false })
    const reloaded = await loadVault(done.session, { api })
    expect(of(reloaded.items, 'credential')[0]!.payload.password).toBe('first-password')
    expect(reloaded.items).toHaveLength(14)
  })

  it('keeps the current version by default and overwrites only when asked', async () => {
    const { api, session, credential } = await populated()
    const { file } = await exportVault(session, opts(api), BACKUP_PASS, FAST)
    const edited = await updateItem(session, { api }, credential, {
      ...credential.payload,
      password: 'newer-password',
    })

    const preview = await previewImport(edited.session, opts(api), BACKUP_PASS, file)
    expect(preview.plan.updates).toHaveLength(1)

    const kept = await applyImport(preview.session, opts(api), preview.plan, { overwrite: false })
    expect(kept).toMatchObject({ created: 0, updated: 0 })
    let now = of((await loadVault(kept.session, { api })).items, 'credential')[0]!
    expect(now.payload.password).toBe('newer-password')

    const overwritten = await applyImport(kept.session, opts(api), preview.plan, {
      overwrite: true,
    })
    expect(overwritten).toMatchObject({ created: 0, updated: 1 })
    now = of((await loadVault(overwritten.session, { api })).items, 'credential')[0]!
    expect(now.payload.password).toBe('first-password')
    expect(now.version).toBe(3)
  })
})

describe('bad files', () => {
  it('fails cleanly for a wrong passphrase, a tampered file and a non-backup', async () => {
    const { api, session } = await populated()
    const { file } = await exportVault(session, opts(api), BACKUP_PASS, FAST)
    await expect(
      previewImport(session, opts(api), 'the wrong passphrase', file),
    ).rejects.toMatchObject({ code: 'DECRYPT_FAILED' })

    const tampered = JSON.parse(file) as { data: string }
    tampered.data = tampered.data.slice(0, -2) + (tampered.data.endsWith('AA') ? 'BB' : 'AA')
    await expect(
      previewImport(session, opts(api), BACKUP_PASS, JSON.stringify(tampered)),
    ).rejects.toMatchObject({ code: 'DECRYPT_FAILED' })

    await expect(
      previewImport(session, opts(api), BACKUP_PASS, '{"hello":1}'),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
    await expect(previewImport(session, opts(api), BACKUP_PASS, 'not json')).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
  })

  it('imports the good items from a hand-made file and reports the bad ones', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const self = of(items, 'member')[0]!
    const google = of(items, 'account', 'Google')[0]!
    const id = () => crypto.randomUUID()
    const file = await createExport(
      BACKUP_PASS,
      [
        { id: self.id, type: 'member', payload: { name: 'Self' } },
        {
          id: google.id,
          type: 'account',
          payload: { accountTypeId: google.payload.accountTypeId, name: 'Google' },
        },
        {
          id: id(),
          type: 'credential',
          payload: { memberId: self.id, accountId: google.id, username: 'good', password: 'ok' },
        },
        {
          id: id(),
          type: 'credential',
          payload: { memberId: self.id, accountId: google.id, username: '', password: 'ok' },
        },
        { id: id(), type: 'wallet', payload: {} },
      ],
      FAST,
    )
    const preview = await previewImport(session, opts(api), BACKUP_PASS, file)
    expect(preview.plan.invalid).toHaveLength(2)
    const done = await applyImport(preview.session, opts(api), preview.plan, { overwrite: false })
    expect(done.created).toBe(1)
  })
})

describe('large imports and limits', () => {
  it('writes in chunks and reports progress', async () => {
    const { api, session } = await signUp()
    const members = Array.from({ length: 120 }, (_, i) => ({
      id: crypto.randomUUID(),
      type: 'member',
      payload: { name: `Person ${i}` },
    }))
    const file = await createExport(BACKUP_PASS, members, FAST)
    const preview = await previewImport(session, opts(api), BACKUP_PASS, file)
    expect(preview.plan.creates).toHaveLength(120)

    const progress = vi.fn()
    const done = await applyImport(preview.session, opts(api), preview.plan, {
      overwrite: false,
      onProgress: progress,
    })
    expect(done.created).toBe(120)
    expect(progress.mock.calls.map((c) => c[0])).toEqual([IMPORT_CHUNK, IMPORT_CHUNK * 2, 120])
    expect((await loadVault(done.session, { api })).items).toHaveLength(12 + 120)
  })

  it('refuses an import that would pass the 1,000 item limit and writes nothing', async () => {
    const { api, session } = await signUp()
    const members = Array.from({ length: 995 }, (_, i) => ({
      id: crypto.randomUUID(),
      type: 'member',
      payload: { name: `Person ${i}` },
    }))
    const file = await createExport(BACKUP_PASS, members, FAST)
    const preview = await previewImport(session, opts(api), BACKUP_PASS, file)
    expect(preview.plan.overQuota).toBe(true)
    await expect(
      applyImport(preview.session, opts(api), preview.plan, { overwrite: false }),
    ).rejects.toBeInstanceOf(ImportError)
    expect((await loadVault(preview.session, { api })).items).toHaveLength(12)
  }, 60_000)
})
