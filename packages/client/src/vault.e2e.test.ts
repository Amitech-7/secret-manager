import { createApp } from '@sm/api/app'
import { harness, type Harness } from '@sm/api/testkit'
import type { KdfParams } from '@sm/crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiRequestError, createApiClient, type ApiClient } from './api'
import { prepareRegistration, type Session } from './auth'
import {
  createItem,
  deleteItem,
  findReferences,
  itemLabel,
  loadVault,
  payloadSchemas,
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

let h: Harness
let app: ReturnType<typeof createApp>
let nextIp = 1
const freshIp = () => `10.8.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`

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
    username: `vaultuser${++counter}`,
    password: PASSWORD,
    kdfParams: FAST,
  })
  const session = await prepared.submit('captcha-ok')
  return { api, session }
}

const of = <T extends VaultItem['type']>(items: VaultItem[], type: T, name?: string) =>
  items.filter(
    (i): i is Extract<VaultItem, { type: T }> =>
      i.type === type && (name === undefined || (i.payload as { name?: string }).name === name),
  )

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as ApiRequestError
  }
  throw new Error('expected a rejection')
}

beforeAll(async () => {
  h = await harness()
  app = createApp(h.deps)
})
afterAll(async () => h.client.close())

describe('a new vault', () => {
  it('opens every seeded item and finds none unreadable', async () => {
    const { api, session } = await signUp()
    const { items, unreadable } = await loadVault(session, { api })
    expect(unreadable).toEqual([])
    expect(items).toHaveLength(12)
    expect(of(items, 'member').map(itemLabel)).toEqual(['Self'])
    expect(of(items, 'account_type')).toHaveLength(5)
    expect(of(items, 'account')).toHaveLength(5)
    expect(of(items, 'bank').map(itemLabel)).toEqual(['Misc'])
    const google = of(items, 'account', 'Google')[0]!
    expect(of(items, 'account_type', 'Web')[0]!.id).toBe(google.payload.accountTypeId)
  })
})

describe('credentials and cards', () => {
  it('round-trips a credential and a card, and the server only ever holds ciphertext', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const self = of(items, 'member')[0]!
    const google = of(items, 'account', 'Google')[0]!
    const bank = of(items, 'bank')[0]!

    const made = await createItem(session, { api }, 'credential', {
      memberId: self.id,
      accountId: google.id,
      username: ' arjun.dev ',
      password: '  p@ss word  ',
      hint: 'first pet',
    })
    const card = await createItem(made.session, { api }, 'card', {
      memberId: self.id,
      bankId: bank.id,
      cardName: 'Travel',
      nameOnCard: 'ARJUN',
      number: '4111 1111-1111 1111',
      expiryDate: '2030-09',
      cvv: '123',
    })

    const reloaded = await loadVault(card.session, { api })
    expect(reloaded.unreadable).toEqual([])
    expect(reloaded.items).toHaveLength(14)
    const cred = reloaded.items.find((i) => i.id === made.item.id)!
    expect(cred.type === 'credential' && cred.payload).toMatchObject({
      username: 'arjun.dev',
      password: '  p@ss word  ', // passwords are never trimmed
      hint: 'first pet',
      remark: '',
      expiryDate: '',
    })
    const savedCard = reloaded.items.find((i) => i.id === card.item.id)!
    expect(savedCard.type === 'card' && savedCard.payload.number).toBe('4111111111111111')

    // Nothing readable is stored: no plaintext field value appears in any stored blob.
    const { rows } = await h.client.query<{ ciphertext: Uint8Array }>(
      `select ciphertext from vault_items where id in ($1, $2)`,
      [made.item.id, card.item.id],
    )
    for (const row of rows) {
      const stored = Buffer.from(row.ciphertext).toString('latin1')
      for (const secret of ['p@ss word', 'arjun.dev', '4111', 'Travel']) {
        expect(stored).not.toContain(secret)
      }
    }
  })

  it('updates, and refuses a stale edit from another device', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const self = of(items, 'member')[0]!
    const google = of(items, 'account', 'Google')[0]!
    const created = await createItem(session, { api }, 'credential', {
      memberId: self.id,
      accountId: google.id,
      username: 'a',
      password: 'one',
    })
    const cred = created.item as Extract<VaultItem, { type: 'credential' }>

    const first = await updateItem(created.session, { api }, cred, {
      ...cred.payload,
      password: 'two',
    })
    expect(first.item.version).toBe(2)

    // A second device still holding version 1 tries to save.
    const stale = await errorOf(
      updateItem(first.session, { api }, cred, {
        ...cred.payload,
        password: 'three',
      }),
    )
    expect(stale.code).toBe('VERSION_CONFLICT')

    const { items: after } = await loadVault(first.session, { api })
    const now = after.find((i) => i.id === cred.id)!
    expect(now.type === 'credential' && now.payload.password).toBe('two')
  })

  it('deletes for good and frees the quota', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const extra = of(items, 'account', 'Misc')[0]!
    const { session: next } = await deleteItem(session, { api }, extra.id)
    const after = await loadVault(next, { api })
    expect(after.items.find((i) => i.id === extra.id)).toBeUndefined()
    expect(after.items).toHaveLength(11)
    const me = await api.me(next.accessToken)
    expect(me.itemCount).toBe(11)
  })
})

describe('integrity', () => {
  it('reports items whose ciphertext was swapped or moved, and still opens the rest', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const [a, b] = of(items, 'account')
    const bank = of(items, 'bank')[0]!

    // A hostile or buggy server swaps two blobs, and re-labels a third row's type.
    await h.client.exec(`
      update vault_items set ciphertext = case id
        when '${a!.id}' then (select ciphertext from vault_items where id = '${b!.id}')
        when '${b!.id}' then (select ciphertext from vault_items where id = '${a!.id}') end
      where id in ('${a!.id}', '${b!.id}')`)
    await h.client.exec(`update vault_items set type = 'member' where id = '${bank.id}'`)

    const loaded = await loadVault(session, { api })
    expect(loaded.unreadable.map((u) => u.id).sort()).toEqual([a!.id, b!.id, bank.id].sort())
    expect(loaded.unreadable.every((u) => u.reason === 'DECRYPT')).toBe(true)
    expect(loaded.items).toHaveLength(12 - 3)
  })

  it("keeps one user's items out of another user's vault", async () => {
    const one = await signUp()
    const two = await signUp()
    const mine = await loadVault(one.session, { api: one.api })
    const theirs = await loadVault(two.session, { api: two.api })
    const ids = new Set(mine.items.map((i) => i.id))
    expect(theirs.items.some((i) => ids.has(i.id))).toBe(false)

    const victim = mine.items[0]!
    const err = await errorOf(
      two.api.updateItem(two.session.accessToken, victim.id, {
        baseVersion: 1,
        ciphertext: 'AQ'.padEnd(60, 'A'),
      }),
    )
    expect(err.status).toBe(404)
  })
})

describe('paging', () => {
  it('returns every item exactly once across small pages', async () => {
    const { api, session } = await signUp()
    let current: Session = session
    const { items } = await loadVault(current, { api })
    const self = of(items, 'member')[0]!
    const google = of(items, 'account', 'Google')[0]!
    for (let i = 0; i < 6; i++) {
      const made = await createItem(current, { api }, 'credential', {
        memberId: self.id,
        accountId: google.id,
        username: `user${i}`,
        password: 'x',
      })
      current = made.session
    }
    const paged = await loadVault(current, { api, pageSize: 5 })
    expect(paged.unreadable).toEqual([])
    expect(paged.items).toHaveLength(18)
    expect(new Set(paged.items.map((i) => i.id)).size).toBe(18)
  })
})

describe('payload validation', () => {
  const uuid = () => crypto.randomUUID()
  const base = {
    memberId: uuid(),
    accountId: uuid(),
    username: 'u',
    password: 'p',
  }

  it('accepts the minimum and rejects bad fields', () => {
    expect(payloadSchemas.credential.safeParse(base).success).toBe(true)
    for (const bad of [
      { ...base, password: '' },
      { ...base, username: '   ' },
      { ...base, username: 'x'.repeat(33) },
      { ...base, memberId: 'not-a-uuid' },
      { ...base, expiryDate: '2026-02-30' },
      { ...base, hint: 'x'.repeat(101) },
    ]) {
      expect(payloadSchemas.credential.safeParse(bad).success).toBe(false)
    }
  })

  it('validates card numbers, cvv and months', () => {
    const card = {
      memberId: uuid(),
      bankId: uuid(),
      cardName: 'c',
      nameOnCard: 'n',
      number: '4111111111111111',
      expiryDate: '2030-12',
      cvv: '123',
    }
    expect(payloadSchemas.card.safeParse(card).success).toBe(true)
    for (const bad of [
      { ...card, number: '4111-abcd' },
      { ...card, number: '123' },
      { ...card, cvv: '12' },
      { ...card, cvv: '12a' },
      { ...card, expiryDate: '2030-13' },
      { ...card, expiryDate: '' },
      { ...card, initialDate: '2030-00' },
    ]) {
      expect(payloadSchemas.card.safeParse(bad).success).toBe(false)
    }
  })
})

describe('findReferences', () => {
  it('finds what still uses a member, bank, account or account type', async () => {
    const { api, session } = await signUp()
    const { items } = await loadVault(session, { api })
    const self = of(items, 'member')[0]!
    const bank = of(items, 'bank')[0]!
    const google = of(items, 'account', 'Google')[0]!
    const web = of(items, 'account_type', 'Web')[0]!
    const bankType = of(items, 'account_type', 'Bank')[0]!

    const a = await createItem(session, { api }, 'credential', {
      memberId: self.id,
      accountId: google.id,
      username: 'u',
      password: 'p',
    })
    const b = await createItem(a.session, { api }, 'card', {
      memberId: self.id,
      bankId: bank.id,
      cardName: 'c',
      nameOnCard: 'n',
      number: '4111111111111111',
      expiryDate: '2030-01',
      cvv: '123',
    })
    const all = [...items, a.item, b.item]

    expect(
      findReferences(all, self)
        .map((i) => i.id)
        .sort(),
    ).toEqual([a.item.id, b.item.id].sort())
    expect(findReferences(all, bank).map((i) => i.id)).toEqual([b.item.id])
    expect(findReferences(all, google).map((i) => i.id)).toEqual([a.item.id])
    expect(
      findReferences(all, web)
        .map((i) => i.id)
        .sort(),
    ).toEqual(
      of(items, 'account')
        .filter((x) => x.payload.accountTypeId === web.id)
        .map((x) => x.id)
        .sort(),
    )
    expect(findReferences(all, bankType)).toEqual([])
    expect(findReferences(all, a.item)).toEqual([])
  })
})
