import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from './testing'

let client: PGlite
const bytes = (n: number, fill = 1) =>
  `decode('${fill.toString(16).padStart(2, '0').repeat(n)}', 'hex')`

const insertUser = (username: string, overrides: Record<string, string> = {}) => {
  const v = {
    username: `'${username}'`,
    auth_hash: bytes(32),
    kdf_salt: bytes(16),
    kdf_params: `'{"alg":"argon2id"}'::jsonb`,
    wrapped_vk_pw: bytes(60),
    wrapped_vk_rec: bytes(60),
    recovery_auth_hash: bytes(32),
    ...overrides,
  }
  return client.query<{ id: string }>(
    `insert into users (${Object.keys(v).join(',')}) values (${Object.values(v).join(',')}) returning id`,
  )
}
const insertItem = (userId: string, type: string, size: number, id?: string) =>
  client.query(
    `insert into vault_items (id, user_id, type, ciphertext) values (${id ? `'${id}'` : 'gen_random_uuid()'}, '${userId}', '${type}', ${bytes(size)})`,
  )

beforeAll(async () => {
  ;({ client } = await createTestDb({
    beforeMigrate: [`create role sm_app`, `create role someone_else`],
  }))
})
afterAll(async () => client.close())

describe('migrations', () => {
  it('create the expected tables', async () => {
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename not like '\\_\\_%' order by 1`,
    )
    expect(rows.map((r) => r.tablename)).toEqual([
      'rate_limits',
      'sessions',
      'users',
      'vault_items',
    ])
  })

  it('give sm_app row access but no DDL or TRUNCATE', async () => {
    const priv = async (role: string, table: string, p: string) =>
      (
        await client.query<{ ok: boolean }>(
          `select has_table_privilege('${role}', 'public.${table}', '${p}') as ok`,
        )
      ).rows[0]!.ok
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(await priv('sm_app', 'vault_items', p)).toBe(true)
    }
    expect(await priv('sm_app', 'users', 'TRUNCATE')).toBe(false)
    expect(
      (
        await client.query<{ ok: boolean }>(
          `select has_schema_privilege('sm_app', 'public', 'CREATE') as ok`,
        )
      ).rows[0]!.ok,
    ).toBe(false)
    expect(await priv('someone_else', 'users', 'SELECT')).toBe(false)
  })
})

describe('users constraints', () => {
  it('accept a well-formed user', async () => {
    const { rows } = await insertUser('alice.dev')
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reject bad usernames (uppercase, spaces, too short, too long) and duplicates', async () => {
    for (const bad of ['Alice', 'has space', 'ab', 'x'.repeat(33), 'semi;colon']) {
      await expect(insertUser(bad)).rejects.toThrow()
    }
    await insertUser('dup.user')
    await expect(insertUser('dup.user')).rejects.toThrow()
  })

  it('reject hashes and salts of the wrong length', async () => {
    await expect(insertUser('badhash', { auth_hash: bytes(31) })).rejects.toThrow()
    await expect(insertUser('badrec', { recovery_auth_hash: bytes(33) })).rejects.toThrow()
    await expect(insertUser('badsalt', { kdf_salt: bytes(15) })).rejects.toThrow()
  })

  it('reject a negative item count', async () => {
    await expect(insertUser('negcount', { item_count: '-1' })).rejects.toThrow()
  })
})

describe('vault_items constraints', () => {
  it('accept every known item type', async () => {
    const { rows } = await insertUser('types.user')
    for (const type of [
      'credential',
      'card',
      'note',
      'member',
      'bank',
      'account_type',
      'account',
    ]) {
      await insertItem(rows[0]!.id, type, 40)
    }
  })

  it('reject unknown types and out-of-range ciphertext sizes', async () => {
    const { rows } = await insertUser('limits.user')
    const id = rows[0]!.id
    await expect(insertItem(id, 'password', 40)).rejects.toThrow()
    await expect(insertItem(id, 'credential', 28)).rejects.toThrow()
    await expect(insertItem(id, 'credential', 8193)).rejects.toThrow()
    await insertItem(id, 'credential', 29)
    await insertItem(id, 'credential', 8192)
  })

  it('reject items for users that do not exist', async () => {
    await expect(
      insertItem('00000000-0000-4000-8000-000000000000', 'credential', 40),
    ).rejects.toThrow()
  })

  it('are deleted with their user (cascade), including sessions', async () => {
    const { rows } = await insertUser('cascade.user')
    const id = rows[0]!.id
    await insertItem(id, 'credential', 40)
    await client.query(
      `insert into sessions (user_id, refresh_hash, expires_at) values ('${id}', ${bytes(32, 7)}, now() + interval '1 day')`,
    )
    await client.query(`delete from users where id = '${id}'`)
    const items = await client.query(`select 1 from vault_items where user_id = '${id}'`)
    const sessions = await client.query(`select 1 from sessions where user_id = '${id}'`)
    expect(items.rows).toHaveLength(0)
    expect(sessions.rows).toHaveLength(0)
  })
})

describe('sessions and rate_limits constraints', () => {
  it('require 32-byte refresh hashes and unique tokens', async () => {
    const { rows } = await insertUser('sess.user')
    const id = rows[0]!.id
    await expect(
      client.query(
        `insert into sessions (user_id, refresh_hash, expires_at) values ('${id}', ${bytes(31)}, now())`,
      ),
    ).rejects.toThrow()
    const ok = `insert into sessions (user_id, refresh_hash, expires_at) values ('${id}', ${bytes(32, 9)}, now())`
    await client.query(ok)
    await expect(client.query(ok)).rejects.toThrow()
  })

  it('key rate-limit counters by (key, window)', async () => {
    await client.query(
      `insert into rate_limits (key, window_start, count) values ('a', '2026-01-01T00:00:00Z', 1)`,
    )
    await client.query(
      `insert into rate_limits (key, window_start, count) values ('a', '2026-01-01T00:01:00Z', 1)`,
    )
    await expect(
      client.query(
        `insert into rate_limits (key, window_start, count) values ('a', '2026-01-01T00:00:00Z', 1)`,
      ),
    ).rejects.toThrow()
  })
})
