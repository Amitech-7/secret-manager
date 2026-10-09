import { users, vaultItems, eq } from '@sm/db'
import { LIMITS } from '@sm/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createSession } from '../auth/session'
import { addUser, harness, TEST_SOURCE, type Harness } from '../testkit'

let h: Harness
let app: ReturnType<typeof createApp>
beforeAll(async () => {
  h = await harness()
  app = createApp(h.deps)
})
afterAll(async () => h.client.close())

interface Actor {
  userId: string
  token: string
}
let counter = 0
async function actor(extra: Partial<typeof users.$inferInsert> = {}): Promise<Actor> {
  const userId = await addUser(h.db, `vault.user${++counter}`, extra)
  const tokens = await createSession(h.db, TEST_SOURCE.JWT_SECRET, userId, h.clock.now)
  return { userId, token: tokens.accessToken }
}

/** Looks like a real envelope to the server: version byte 1, then opaque bytes. */
const blob = (size = 60, fill = 7) =>
  Buffer.from([1, ...new Uint8Array(size - 1).fill(fill)]).toString('base64url')

let ipCounter = 0
const call = (who: Actor | null, method: string, path: string, body?: unknown) =>
  app.request(`/api/v1/vault${path}`, {
    method,
    headers: {
      ...(who ? { authorization: `Bearer ${who.token}` } : {}),
      'content-type': 'application/json',
      'x-real-ip': `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const create = (who: Actor, over: Record<string, unknown> = {}) =>
  call(who, 'POST', '/items', {
    id: crypto.randomUUID(),
    type: 'credential',
    ciphertext: blob(),
    ...over,
  })

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code

describe('auth', () => {
  it('requires a signed-in user on every route', async () => {
    const id = crypto.randomUUID()
    for (const [method, path] of [
      ['GET', '/items'],
      ['POST', '/items'],
      ['PUT', `/items/${id}`],
      ['DELETE', `/items/${id}`],
    ] as const) {
      const body = method === 'GET' || method === 'DELETE' ? undefined : {}
      expect((await call(null, method, path, body)).status).toBe(401)
    }
  })
})

describe('create', () => {
  it('stores the item, returns version 1 and bumps the counter', async () => {
    const a = await actor()
    const res = await create(a)
    expect(res.status).toBe(201)
    expect(((await res.json()) as { version: number }).version).toBe(1)
    const [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u!.itemCount).toBe(1)
  })

  it('rejects unknown types, notes, bad blobs and extra fields', async () => {
    const a = await actor()
    expect((await create(a, { type: 'note' })).status).toBe(400)
    expect((await create(a, { type: 'password' })).status).toBe(400)
    expect((await create(a, { ciphertext: 'not base64 !!' })).status).toBe(400)
    expect((await create(a, { ciphertext: blob(28) })).status).toBe(400)
    expect((await create(a, { ciphertext: blob(LIMITS.maxItemBytes + 1) })).status).toBe(400)
    expect(
      (
        await create(a, {
          ciphertext: Buffer.from([2, 1, 1]).toString('base64url'),
        })
      ).status,
    ).toBe(400)
    expect((await create(a, { extra: 1 })).status).toBe(400)
    expect((await create(a, { id: 'nope' })).status).toBe(400)
    expect((await create(a, { ciphertext: blob(LIMITS.maxItemBytes) })).status).toBe(201)
    const [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u!.itemCount).toBe(1)
  })

  it('rejects a duplicate id without leaking a counter increment', async () => {
    const a = await actor()
    const id = crypto.randomUUID()
    expect((await create(a, { id })).status).toBe(201)
    expect((await create(a, { id })).status).toBe(400)
    const [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u!.itemCount).toBe(1)
  })

  it('does not let a second user take over an id that exists', async () => {
    const a = await actor()
    const b = await actor()
    const id = crypto.randomUUID()
    expect((await create(a, { id })).status).toBe(201)
    expect((await create(b, { id })).status).toBe(400)
    const [u] = await h.db.select().from(users).where(eq(users.id, b.userId))
    expect(u!.itemCount).toBe(0)
  })

  it('enforces the quota exactly, even for parallel creates', async () => {
    const a = await actor({ itemCount: LIMITS.maxItemsPerUser - 1 })
    const results = await Promise.all(Array.from({ length: 20 }, () => create(a)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 201)).toHaveLength(1)
    const rejected = results.filter((r) => r.status !== 201)
    expect(rejected).toHaveLength(19)
    expect(await codeOf(rejected[0]!)).toBe('QUOTA_EXCEEDED')
    const [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u!.itemCount).toBe(LIMITS.maxItemsPerUser)
    expect(
      (await h.db.select().from(vaultItems).where(eq(vaultItems.userId, a.userId))).length,
    ).toBe(1)
  })
})

describe('update', () => {
  it('bumps the version and replaces the ciphertext', async () => {
    const a = await actor()
    const id = crypto.randomUUID()
    await create(a, { id })
    const res = await call(a, 'PUT', `/items/${id}`, {
      baseVersion: 1,
      ciphertext: blob(80, 9),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { version: number }).version).toBe(2)
    const [row] = await h.db.select().from(vaultItems).where(eq(vaultItems.id, id))
    expect(Buffer.from(row!.ciphertext).toString('base64url')).toBe(blob(80, 9))
  })

  it('refuses a stale write and keeps the newer data', async () => {
    const a = await actor()
    const id = crypto.randomUUID()
    await create(a, { id })
    expect(
      (
        await call(a, 'PUT', `/items/${id}`, {
          baseVersion: 1,
          ciphertext: blob(70, 2),
        })
      ).status,
    ).toBe(200)
    const stale = await call(a, 'PUT', `/items/${id}`, {
      baseVersion: 1,
      ciphertext: blob(70, 3),
    })
    expect(stale.status).toBe(409)
    expect(await codeOf(stale)).toBe('VERSION_CONFLICT')
    const [row] = await h.db.select().from(vaultItems).where(eq(vaultItems.id, id))
    expect(Buffer.from(row!.ciphertext).toString('base64url')).toBe(blob(70, 2))
  })

  it('only one of two parallel edits from the same version wins', async () => {
    const a = await actor()
    const id = crypto.randomUUID()
    await create(a, { id })
    const results = await Promise.all([
      call(a, 'PUT', `/items/${id}`, {
        baseVersion: 1,
        ciphertext: blob(70, 4),
      }),
      call(a, 'PUT', `/items/${id}`, {
        baseVersion: 1,
        ciphertext: blob(70, 5),
      }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })

  it('cannot change the type, and returns NOT_FOUND for a missing item', async () => {
    const a = await actor()
    const id = crypto.randomUUID()
    await create(a, { id })
    expect(
      (
        await call(a, 'PUT', `/items/${id}`, {
          baseVersion: 1,
          type: 'card',
          ciphertext: blob(),
        })
      ).status,
    ).toBe(400)
    const missing = await call(a, 'PUT', `/items/${crypto.randomUUID()}`, {
      baseVersion: 1,
      ciphertext: blob(),
    })
    expect(missing.status).toBe(404)
    expect(
      (
        await call(a, 'PUT', '/items/not-a-uuid', {
          baseVersion: 1,
          ciphertext: blob(),
        })
      ).status,
    ).toBe(400)
  })
})

describe('delete', () => {
  it('removes the item, decrements the counter and is idempotent', async () => {
    const a = await actor()
    const id = crypto.randomUUID()
    await create(a, { id })
    await create(a)
    expect((await call(a, 'DELETE', `/items/${id}`)).status).toBe(204)
    expect((await call(a, 'DELETE', `/items/${id}`)).status).toBe(204)
    expect((await call(a, 'DELETE', `/items/${crypto.randomUUID()}`)).status).toBe(204)
    const [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u!.itemCount).toBe(1)
    expect(
      (await h.db.select().from(vaultItems).where(eq(vaultItems.userId, a.userId))).length,
    ).toBe(1)
  })
})

describe('isolation', () => {
  it("never shows, edits or deletes another user's items", async () => {
    const a = await actor()
    const b = await actor()
    const id = crypto.randomUUID()
    await create(a, { id })

    const listB = (await (await call(b, 'GET', '/items')).json()) as {
      items: unknown[]
    }
    expect(listB.items).toEqual([])
    expect(
      (
        await call(b, 'PUT', `/items/${id}`, {
          baseVersion: 1,
          ciphertext: blob(70, 8),
        })
      ).status,
    ).toBe(404)
    expect((await call(b, 'DELETE', `/items/${id}`)).status).toBe(204)

    const listA = (await (await call(a, 'GET', '/items')).json()) as {
      items: { id: string }[]
    }
    expect(listA.items.map((i) => i.id)).toEqual([id])
    const [ua] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(ua!.itemCount).toBe(1)
    const [ub] = await h.db.select().from(users).where(eq(users.id, b.userId))
    expect(ub!.itemCount).toBe(0)
  })
})

describe('list', () => {
  it('pages through everything exactly once with a keyset cursor', async () => {
    const a = await actor()
    const ids = Array.from({ length: 7 }, () => crypto.randomUUID())
    for (const id of ids) await create(a, { id })

    const seen: string[] = []
    let after: string | null = null
    let pages = 0
    do {
      const url: string = `/items?limit=3${after ? `&after=${after}` : ''}`
      const body = (await (await call(a, 'GET', url)).json()) as {
        items: {
          id: string
          type: string
          ciphertext: string
          version: number
        }[]
        nextCursor: string | null
      }
      pages++
      seen.push(...body.items.map((i) => i.id))
      expect(body.items[0]?.ciphertext).toBe(blob())
      after = body.nextCursor
    } while (after)

    expect(pages).toBe(3)
    expect(seen).toEqual([...ids].sort())
  })

  it('ends with a null cursor when the last page is not full, and validates the query', async () => {
    const a = await actor()
    await create(a)
    const body = (await (await call(a, 'GET', '/items')).json()) as {
      nextCursor: unknown
    }
    expect(body.nextCursor).toBeNull()
    expect((await call(a, 'GET', '/items?limit=0')).status).toBe(400)
    expect((await call(a, 'GET', `/items?limit=${LIMITS.vaultPageMaxItems + 1}`)).status).toBe(400)
    expect((await call(a, 'GET', '/items?after=nope')).status).toBe(400)
  })
})
