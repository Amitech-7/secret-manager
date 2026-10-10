import { and, eq, sql, users, vaultItems } from '@sm/db'
import { ITEM_TYPES, LIMITS } from '@sm/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { ciphertextSchema } from '../auth/schemas'
import { b64u } from '../auth/tokens'
import type { AuthedEnv } from '../deps'
import { AppError } from '../errors'
import { rateLimit } from '../rateLimit'
import { parseJson } from '../validate'

/**
 * Encrypted items. The server never sees plaintext: it stores opaque ciphertext, checks size and
 * ownership, keeps `users.item_count` exact, and uses `version` so a stale edit cannot silently
 * overwrite a newer one.
 */
export const vault = new Hono<AuthedEnv>()

const perUser = (group: string, limit: number, windowSec: number) =>
  rateLimit<AuthedEnv>({
    group,
    limit,
    windowSec,
    identity: (c) => c.get('userId'),
  })

// Per-IP first (cheap, runs before the database lookup in requireAuth), then per-user.
vault.use(
  '*',
  rateLimit({ group: 'vault-ip', limit: 300, windowSec: 60 }),
  requireAuth,
  perUser('vault', 120, 60),
)

const idSchema = z.uuid()

const listQuerySchema = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.vaultPageMaxItems).optional(),
})

const createSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(ITEM_TYPES),
    ciphertext: ciphertextSchema,
  })
  .strict()

// `type` is deliberately absent: it is bound into the ciphertext, so it can never change.
const updateSchema = z
  .object({
    baseVersion: z.number().int().min(1),
    ciphertext: ciphertextSchema,
  })
  .strict()

/** Import writes in chunks; 50 maximum-size items is about 550 KB, far below the body limit. */
export const MAX_BATCH_ITEMS = 50

const batchCreateSchema = z
  .object({
    items: z
      .array(
        z.object({ id: z.uuid(), type: z.enum(ITEM_TYPES), ciphertext: ciphertextSchema }).strict(),
      )
      .min(1)
      .max(MAX_BATCH_ITEMS),
  })
  .strict()

const batchUpdateSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            baseVersion: z.number().int().min(1),
            ciphertext: ciphertextSchema,
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BATCH_ITEMS),
  })
  .strict()

const hasDuplicates = (ids: string[]) => new Set(ids).size !== ids.length

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; i++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true
  }
  return false
}

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64url'))

const parseId = (raw: string | undefined): string => {
  const parsed = idSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid item id')
  return parsed.data
}

// --- list (paged, keyset on id) ---------------------------------------------------------------

vault.get('/items', async (c) => {
  const query = listQuerySchema.parse(c.req.query())
  const limit = query.limit ?? LIMITS.vaultPageMaxItems
  const rows = await c
    .get('deps')
    .getDb()
    .select({
      id: vaultItems.id,
      type: vaultItems.type,
      ciphertext: vaultItems.ciphertext,
      version: vaultItems.version,
      createdAt: vaultItems.createdAt,
      updatedAt: vaultItems.updatedAt,
    })
    .from(vaultItems)
    .where(
      and(
        eq(vaultItems.userId, c.get('userId')),
        query.after ? sql`${vaultItems.id} > ${query.after}` : undefined,
      ),
    )
    .orderBy(vaultItems.id)
    .limit(limit)

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      ciphertext: b64u(r.ciphertext),
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    // A full page means there may be more; the client asks again from the last id.
    nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
  })
})

// --- create -----------------------------------------------------------------------------------

vault.post('/items', async (c) => {
  const deps = c.get('deps')
  const userId = c.get('userId')
  const body = await parseJson(c, createSchema)
  const now = deps.now()

  try {
    await deps.getDb().transaction(async (tx) => {
      // One atomic statement is both the quota check and the counter bump. Two parallel creates
      // at 999 items serialise on this row lock, so exactly one of them succeeds.
      const bumped = await tx
        .update(users)
        .set({ itemCount: sql`${users.itemCount} + 1` })
        .where(and(eq(users.id, userId), sql`${users.itemCount} < ${LIMITS.maxItemsPerUser}`))
        .returning({ n: users.itemCount })
      if (bumped.length === 0) {
        throw new AppError('QUOTA_EXCEEDED', `Item limit reached (${LIMITS.maxItemsPerUser})`)
      }
      await tx.insert(vaultItems).values({
        id: body.id,
        userId,
        type: body.type,
        ciphertext: bytes(body.ciphertext),
        createdAt: now,
        updatedAt: now,
      })
    })
  } catch (err) {
    // The transaction has rolled back, so the counter bump is undone too.
    if (isUniqueViolation(err)) throw new AppError('VALIDATION', 'Duplicate item id')
    throw err
  }
  return c.json({ id: body.id, version: 1, updatedAt: now.toISOString() }, 201)
})

// --- batch create / update (used by import) ---------------------------------------------------
// Registered before the `/items/:id` routes so that "batch" is never read as an id.

vault.post('/items/batch', async (c) => {
  const deps = c.get('deps')
  const userId = c.get('userId')
  const body = await parseJson(c, batchCreateSchema)
  if (hasDuplicates(body.items.map((i) => i.id))) {
    throw new AppError('VALIDATION', 'Duplicate item id')
  }
  const now = deps.now()
  const n = body.items.length

  try {
    await deps.getDb().transaction(async (tx) => {
      // All or nothing: either the whole chunk fits under the quota and is stored, or none is.
      const bumped = await tx
        .update(users)
        .set({ itemCount: sql`${users.itemCount} + ${n}` })
        .where(
          and(eq(users.id, userId), sql`${users.itemCount} + ${n} <= ${LIMITS.maxItemsPerUser}`),
        )
        .returning({ n: users.itemCount })
      if (bumped.length === 0) {
        throw new AppError('QUOTA_EXCEEDED', `Item limit reached (${LIMITS.maxItemsPerUser})`)
      }
      await tx.insert(vaultItems).values(
        body.items.map((i) => ({
          id: i.id,
          userId,
          type: i.type,
          ciphertext: bytes(i.ciphertext),
          createdAt: now,
          updatedAt: now,
        })),
      )
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('VALIDATION', 'Duplicate item id')
    throw err
  }
  return c.json({ count: n }, 201)
})

vault.put('/items/batch', async (c) => {
  const deps = c.get('deps')
  const userId = c.get('userId')
  const body = await parseJson(c, batchUpdateSchema)
  if (hasDuplicates(body.items.map((i) => i.id))) {
    throw new AppError('VALIDATION', 'Duplicate item id')
  }
  const db = deps.getDb()
  const now = deps.now()

  await db.transaction(async (tx) => {
    for (const item of body.items) {
      const [row] = await tx
        .update(vaultItems)
        .set({
          ciphertext: bytes(item.ciphertext),
          version: sql`${vaultItems.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(vaultItems.id, item.id),
            eq(vaultItems.userId, userId),
            eq(vaultItems.version, item.baseVersion),
          ),
        )
        .returning({ id: vaultItems.id })
      if (!row) {
        const [existing] = await tx
          .select({ id: vaultItems.id })
          .from(vaultItems)
          .where(and(eq(vaultItems.id, item.id), eq(vaultItems.userId, userId)))
          .limit(1)
        // Throwing rolls back every update made so far in this chunk.
        if (!existing) throw new AppError('NOT_FOUND', 'Item not found')
        throw new AppError('VERSION_CONFLICT', 'An item changed elsewhere. Reload and try again.')
      }
    }
  })
  return c.json({ count: body.items.length })
})

// --- update (optimistic concurrency) ----------------------------------------------------------

vault.put('/items/:id', async (c) => {
  const deps = c.get('deps')
  const userId = c.get('userId')
  const id = parseId(c.req.param('id'))
  const body = await parseJson(c, updateSchema)
  const db = deps.getDb()
  const now = deps.now()

  const [row] = await db
    .update(vaultItems)
    .set({
      ciphertext: bytes(body.ciphertext),
      version: sql`${vaultItems.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(vaultItems.id, id),
        eq(vaultItems.userId, userId),
        eq(vaultItems.version, body.baseVersion),
      ),
    )
    .returning({
      version: vaultItems.version,
      updatedAt: vaultItems.updatedAt,
    })

  if (!row) {
    const [existing] = await db
      .select({ id: vaultItems.id })
      .from(vaultItems)
      .where(and(eq(vaultItems.id, id), eq(vaultItems.userId, userId)))
      .limit(1)
    if (!existing) throw new AppError('NOT_FOUND', 'Item not found')
    throw new AppError('VERSION_CONFLICT', 'This item changed elsewhere. Reload and try again.')
  }
  return c.json({
    id,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  })
})

// --- delete (hard, idempotent) ----------------------------------------------------------------

vault.delete('/items/:id', async (c) => {
  const userId = c.get('userId')
  const id = parseId(c.req.param('id'))
  await c
    .get('deps')
    .getDb()
    .transaction(async (tx) => {
      const removed = await tx
        .delete(vaultItems)
        .where(and(eq(vaultItems.id, id), eq(vaultItems.userId, userId)))
        .returning({ id: vaultItems.id })
      if (removed.length > 0) {
        await tx
          .update(users)
          .set({ itemCount: sql`greatest(${users.itemCount} - 1, 0)` })
          .where(eq(users.id, userId))
      }
    })
  return c.body(null, 204)
})
