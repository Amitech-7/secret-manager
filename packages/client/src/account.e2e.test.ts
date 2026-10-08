import { createApp } from '@sm/api/app'
import { harness, type Harness } from '@sm/api/testkit'
import {
  CryptoError,
  decryptItem,
  deriveRecoveryKeys,
  fromBase64Url,
  parseRecoveryKey,
  toBase64Url,
  type KdfParams,
} from '@sm/crypto'
import { DEFAULT_KDF_PARAMS } from '@sm/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { changePassword, deleteAccount, prepareRecovery, prepareRecoveryRotation } from './account'
import { ApiRequestError, createApiClient, type ApiClient } from './api'
import { login, prepareRegistration, refreshSession, type Session } from './auth'

const FAST: KdfParams = {
  alg: 'argon2id',
  version: 19,
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
}
const PASSWORD = 'violet tractor ceiling marathon pebble'
const NEW_PASSWORD = 'harbor lantern quartz meadow violin'

let h: Harness
let app: ReturnType<typeof createApp>
let nextIp = 1
const freshIp = () => `10.7.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`
const requests: Array<{ method: string; path: string }> = []

const clientAt = (ip = freshIp()): ApiClient =>
  createApiClient({
    baseUrl: 'http://localhost',
    fetch: async (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      headers.set('x-real-ip', ip)
      requests.push({ method: init?.method ?? 'GET', path: url.pathname })
      return app.request(url.pathname + url.search, { ...init, headers })
    },
  })

let counter = 0
const newName = (p = 'acct') => `${p}${++counter}`

async function signUp(username = newName(), password = PASSWORD) {
  const prepared = await prepareRegistration({
    api: clientAt(),
    username,
    password,
    kdfParams: FAST,
  })
  const session = await prepared.submit('ok')
  return { username, session, recoveryKey: prepared.recoveryKey }
}
const signIn = (username: string, password: string) =>
  login({ api: clientAt(), username, password })

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as ApiRequestError & CryptoError
  }
  throw new Error('expected a failure')
}

const alive = async (s: Session) => {
  try {
    await clientAt().me(s.accessToken)
    return true
  } catch {
    return false
  }
}

async function seedRows(username: string) {
  const { rows } = await h.client.query<{ id: string; type: string; ciphertext: Uint8Array }>(
    `select i.id, i.type, i.ciphertext from vault_items i join users u on u.id = i.user_id where u.username = $1`,
    [username],
  )
  return rows
}
async function canDecryptSeed(s: Session, username: string) {
  const rows = await seedRows(username)
  expect(rows.length).toBeGreaterThan(0)
  const out = await Promise.all(
    rows.map((r) =>
      decryptItem(s.vaultKey, { itemId: r.id, type: r.type }, toBase64Url(r.ciphertext)),
    ),
  )
  return out.some((p) => (p as { name?: string }).name === 'Self')
}

beforeAll(async () => {
  h = await harness()
  app = createApp(h.deps)
})
afterAll(async () => h.client.close())

describe('change password', () => {
  it('switches to the new password, keeps every item readable, and upgrades the KDF parameters', async () => {
    const { username, session } = await signUp()
    await changePassword({
      api: clientAt(),
      accessToken: session.accessToken,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect((await errorOf(signIn(username, PASSWORD))).code).toBe('INVALID_CREDENTIALS')
    const fresh = await signIn(username, NEW_PASSWORD)
    expect(await canDecryptSeed(fresh, username)).toBe(true)
    // Registered with the cheap test settings; the change moved it to the current defaults.
    expect((await clientAt().me(fresh.accessToken)).kdfParams).toEqual(DEFAULT_KDF_PARAMS)
  })

  it('signs out every other session but keeps the current one', async () => {
    const { username, session: here } = await signUp()
    const other = await signIn(username, PASSWORD)
    await changePassword({
      api: clientAt(),
      accessToken: here.accessToken,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      kdfParams: FAST,
    })
    expect(await alive(here)).toBe(true)
    expect(await alive(other)).toBe(false)
    expect((await errorOf(refreshSession(other, { api: clientAt() }))).code).toBe('UNAUTHENTICATED')
    await expect(refreshSession(here, { api: clientAt() })).resolves.toBeDefined()
  })

  it('fails locally on a wrong current password and sends no change request', async () => {
    const { username, session } = await signUp()
    requests.length = 0
    const err = await errorOf(
      changePassword({
        api: clientAt(),
        accessToken: session.accessToken,
        currentPassword: 'not the right password',
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    )
    expect(err.code).toBe('DECRYPT_FAILED')
    expect(requests.some((r) => r.path.endsWith('/password/change'))).toBe(false)
    await expect(signIn(username, PASSWORD)).resolves.toBeDefined()
  })

  it('the server rejects a wrong current key on its own and changes nothing', async () => {
    const { username, session } = await signUp()
    const api = clientAt()
    const me = await api.me(session.accessToken)
    const bogus = toBase64Url(new Uint8Array(32).fill(7))
    const err = await errorOf(
      api.changePassword(session.accessToken, {
        currentAuthKey: bogus,
        newAuthKey: bogus,
        newKdfSalt: me.kdfSalt,
        newKdfParams: FAST,
        newWrappedVkPw: me.wrappedVkPw,
      }),
    )
    expect(err.code).toBe('INVALID_CREDENTIALS')
    await expect(signIn(username, PASSWORD)).resolves.toBeDefined()
  })

  it('is limited to 5 attempts per 15 minutes per user, and needs a login', async () => {
    const { session } = await signUp()
    const api = clientAt()
    const me = await api.me(session.accessToken)
    const bogus = toBase64Url(new Uint8Array(32).fill(9))
    const attempt = () =>
      errorOf(
        api.changePassword(session.accessToken, {
          currentAuthKey: bogus,
          newAuthKey: bogus,
          newKdfSalt: me.kdfSalt,
          newKdfParams: FAST,
          newWrappedVkPw: me.wrappedVkPw,
        }),
      )
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).status)
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    expect(
      (
        await errorOf(
          api.changePassword('', {
            currentAuthKey: bogus,
            newAuthKey: bogus,
            newKdfSalt: me.kdfSalt,
            newKdfParams: FAST,
            newWrappedVkPw: me.wrappedVkPw,
          }),
        )
      ).code,
    ).toBe('UNAUTHENTICATED')
  })

  it('rejects weak KDF parameters and malformed fields', async () => {
    const { session } = await signUp()
    const api = clientAt()
    const me = await api.me(session.accessToken)
    const ok = {
      currentAuthKey: toBase64Url(new Uint8Array(32)),
      newAuthKey: toBase64Url(new Uint8Array(32)),
      newKdfSalt: me.kdfSalt,
      newKdfParams: FAST,
      newWrappedVkPw: me.wrappedVkPw,
    }
    const bad = [
      { ...ok, newKdfParams: { ...FAST, memoryKiB: 1024 } },
      { ...ok, newWrappedVkPw: toBase64Url(new Uint8Array(10)) },
      { ...ok, extra: 1 },
    ]
    for (const body of bad) {
      expect((await errorOf(api.changePassword(session.accessToken, body as never))).code).toBe(
        'VALIDATION',
      )
    }
  })
})

describe('rotate recovery key', () => {
  it('the old key stops working and the new one works', async () => {
    const { username, session, recoveryKey: oldKey } = await signUp()
    const prepared = await prepareRecoveryRotation({
      api: clientAt(),
      accessToken: session.accessToken,
      password: PASSWORD,
      kdfParams: FAST,
    })
    expect(prepared.recoveryKey).not.toBe(oldKey)
    await prepared.submit(session.accessToken)

    const withOld = await errorOf(
      prepareRecovery({
        api: clientAt(),
        username,
        recoveryKey: oldKey,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    )
    expect(withOld.code).toBe('INVALID_CREDENTIALS')
    const withNew = await prepareRecovery({
      api: clientAt(),
      username,
      recoveryKey: prepared.recoveryKey,
      newPassword: NEW_PASSWORD,
      kdfParams: FAST,
    })
    const recovered = await withNew.submit()
    expect(await canDecryptSeed(recovered, username)).toBe(true)
  })

  it('changes nothing until submit, and needs the right master password', async () => {
    const { username, session, recoveryKey: oldKey } = await signUp()
    await prepareRecoveryRotation({
      api: clientAt(),
      accessToken: session.accessToken,
      password: PASSWORD,
      kdfParams: FAST,
    })
    // Prepared but never submitted: the old key still works.
    await expect(
      prepareRecovery({
        api: clientAt(),
        username,
        recoveryKey: oldKey,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    ).resolves.toBeDefined()

    const wrong = await errorOf(
      prepareRecoveryRotation({
        api: clientAt(),
        accessToken: session.accessToken,
        password: 'definitely the wrong one',
        kdfParams: FAST,
      }),
    )
    expect(wrong.code).toBe('DECRYPT_FAILED')
  })
})

describe('forgot password (recovery)', () => {
  it('sets a new password, replaces the recovery key, signs out every session, and keeps the vault readable', async () => {
    const { username, session: a, recoveryKey } = await signUp()
    const b = await signIn(username, PASSWORD)

    // Typed the way a person might: lowercase, spaces instead of dashes.
    const typed = recoveryKey.toLowerCase().replace(/-/g, ' ')
    const prepared = await prepareRecovery({
      api: clientAt(),
      username: username.toUpperCase(),
      recoveryKey: typed,
      newPassword: NEW_PASSWORD,
      kdfParams: FAST,
    })
    expect(prepared.recoveryKey).not.toBe(recoveryKey)
    expect(prepared.expiresIn).toBe(600)

    // Nothing has changed on the server yet.
    await expect(signIn(username, PASSWORD)).resolves.toBeDefined()

    const c = await prepared.submit()
    expect(await canDecryptSeed(c, username)).toBe(true)
    expect(await alive(c)).toBe(true)
    expect(await alive(a)).toBe(false)
    expect(await alive(b)).toBe(false)

    expect((await errorOf(signIn(username, PASSWORD))).code).toBe('INVALID_CREDENTIALS')
    expect(await canDecryptSeed(await signIn(username, NEW_PASSWORD), username)).toBe(true)

    // The old recovery key is dead; the replacement works.
    expect(
      (
        await errorOf(
          prepareRecovery({
            api: clientAt(),
            username,
            recoveryKey,
            newPassword: NEW_PASSWORD,
            kdfParams: FAST,
          }),
        )
      ).code,
    ).toBe('INVALID_CREDENTIALS')
    await expect(
      prepareRecovery({
        api: clientAt(),
        username,
        recoveryKey: prepared.recoveryKey,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    ).resolves.toBeDefined()
  })

  it('answers a wrong key and an unknown username identically, and catches typos locally', async () => {
    const { username } = await signUp()
    const { recoveryKey: someOtherKey } = await signUp()
    const wrongKey = await errorOf(
      prepareRecovery({
        api: clientAt(),
        username,
        recoveryKey: someOtherKey,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    )
    const ghost = await errorOf(
      prepareRecovery({
        api: clientAt(),
        username: newName('ghost'),
        recoveryKey: someOtherKey,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    )
    expect(wrongKey.code).toBe('INVALID_CREDENTIALS')
    expect(ghost.code).toBe('INVALID_CREDENTIALS')
    expect(wrongKey.message).toBe(ghost.message)

    requests.length = 0
    const typo = someOtherKey.slice(0, -1) + (someOtherKey.endsWith('0') ? '1' : '0')
    const err = await errorOf(
      prepareRecovery({
        api: clientAt(),
        username,
        recoveryKey: typo,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      }),
    )
    expect(err.code).toBe('INVALID_RECOVERY_KEY')
    expect(requests).toHaveLength(0)
  })

  it('a recovery proof works once: the second use of the same step-1 result fails', async () => {
    const { username, recoveryKey } = await signUp()
    const first = await prepareRecovery({
      api: clientAt(),
      username,
      recoveryKey,
      newPassword: NEW_PASSWORD,
      kdfParams: FAST,
    })
    const second = await prepareRecovery({
      api: clientAt(),
      username,
      recoveryKey,
      newPassword: 'another long passphrase here',
      kdfParams: FAST,
    })
    await first.submit()
    expect((await errorOf(second.submit())).code).toBe('UNAUTHENTICATED')
    // The password from the first attempt is the one in force.
    await expect(signIn(username, NEW_PASSWORD)).resolves.toBeDefined()
  })

  it('of two concurrent submissions exactly one succeeds', async () => {
    const { username, recoveryKey } = await signUp()
    const a = await prepareRecovery({
      api: clientAt(),
      username,
      recoveryKey,
      newPassword: NEW_PASSWORD,
      kdfParams: FAST,
    })
    const b = await prepareRecovery({
      api: clientAt(),
      username,
      recoveryKey,
      newPassword: 'another long passphrase here',
      kdfParams: FAST,
    })
    const results = await Promise.allSettled([a.submit(), b.submit()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })

  it('the step-1 proof expires after 10 minutes', async () => {
    const { username, recoveryKey } = await signUp()
    const prepared = await prepareRecovery({
      api: clientAt(),
      username,
      recoveryKey,
      newPassword: NEW_PASSWORD,
      kdfParams: FAST,
    })
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000)
    expect((await errorOf(prepared.submit())).code).toBe('TOKEN_EXPIRED')
    await expect(signIn(username, PASSWORD)).resolves.toBeDefined()
  })

  it('turns two-factor off, so it must be set up again', async () => {
    const { username, recoveryKey } = await signUp()
    await h.client.query(
      `update users set totp_enabled = true, totp_secret_enc = decode('00', 'hex') where username = $1`,
      [username],
    )
    await (
      await prepareRecovery({
        api: clientAt(),
        username,
        recoveryKey,
        newPassword: NEW_PASSWORD,
        kdfParams: FAST,
      })
    ).submit()
    const { rows } = await h.client.query<{ totp_enabled: boolean; has_secret: boolean }>(
      `select totp_enabled, totp_secret_enc is not null as has_secret from users where username = $1`,
      [username],
    )
    expect(rows[0]).toEqual({ totp_enabled: false, has_secret: false })
  })

  it('refuses to reuse the same recovery key as the replacement', async () => {
    const { username, recoveryKey } = await signUp()
    const api = clientAt()
    const old = await deriveRecoveryKeys(await parseRecoveryKey(recoveryKey))
    const begin = await api.recoverBegin(username, toBase64Url(old.recoveryAuth))
    const me = { kdfSalt: toBase64Url(new Uint8Array(16)) }
    const blob = toBase64Url(new Uint8Array(61).fill(1))
    const err = await errorOf(
      api.recoverComplete({
        recoveryToken: begin.recoveryToken,
        newAuthKey: toBase64Url(new Uint8Array(32).fill(2)),
        newKdfSalt: me.kdfSalt,
        newKdfParams: FAST,
        newWrappedVkPw: blob,
        newWrappedVkRec: blob,
        newRecoveryAuth: toBase64Url(old.recoveryAuth),
      }),
    )
    expect(err.code).toBe('VALIDATION')
    expect(fromBase64Url(begin.wrappedVkRec)).toHaveLength(61)
  })

  it('limits attempts to 5 per hour per username', async () => {
    const { username } = await signUp()
    const { recoveryKey: wrong } = await signUp()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await errorOf(
            prepareRecovery({
              api: clientAt(freshIp()),
              username,
              recoveryKey: wrong,
              newPassword: NEW_PASSWORD,
              kdfParams: FAST,
            }),
          )
        ).status,
      )
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
  })
})

describe('delete account', () => {
  it('needs the right password', async () => {
    const { username, session } = await signUp()
    const err = await errorOf(
      deleteAccount({
        api: clientAt(),
        accessToken: session.accessToken,
        password: 'not my password at all',
        kdfParams: FAST,
      }),
    )
    expect(err.code).toBe('INVALID_CREDENTIALS')
    await expect(signIn(username, PASSWORD)).resolves.toBeDefined()
  })

  it('removes the user, every item and every session, and frees the username', async () => {
    const { username, session } = await signUp()
    await signIn(username, PASSWORD)
    await deleteAccount({ api: clientAt(), accessToken: session.accessToken, password: PASSWORD })

    const count = async (sql: string, params: unknown[] = []) =>
      (await h.client.query<{ n: number }>(sql, params)).rows[0]!.n
    expect(
      await count(`select count(*)::int as n from users where username = $1`, [username]),
    ).toBe(0)
    // No item or session is left pointing at a user that no longer exists.
    expect(
      await count(
        `select count(*)::int as n from vault_items i where not exists (select 1 from users u where u.id = i.user_id)`,
      ),
    ).toBe(0)
    expect(
      await count(
        `select count(*)::int as n from sessions s where not exists (select 1 from users u where u.id = s.user_id)`,
      ),
    ).toBe(0)
    expect(await alive(session)).toBe(false)
    expect((await errorOf(signIn(username, PASSWORD))).code).toBe('INVALID_CREDENTIALS')
    await expect(signUp(username)).resolves.toBeDefined()
  })

  it('is limited to 5 attempts per 15 minutes', async () => {
    const { session } = await signUp()
    const api = clientAt()
    const bogus = toBase64Url(new Uint8Array(32).fill(3))
    const statuses: number[] = []
    for (let i = 0; i < 6; i++)
      statuses.push((await errorOf(api.deleteAccount(session.accessToken, bogus))).status)
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
  })
})

describe('/me exposes what the client needs to re-derive keys', () => {
  it('returns the public salt and wrapped key, never the hash', async () => {
    const { session, username } = await signUp()
    const me = await clientAt().me(session.accessToken)
    const { rows } = await h.client.query<{ kdf_salt: Uint8Array; wrapped_vk_pw: Uint8Array }>(
      `select kdf_salt, wrapped_vk_pw from users where username = $1`,
      [username],
    )
    expect(me.kdfSalt).toBe(toBase64Url(rows[0]!.kdf_salt))
    expect(me.wrappedVkPw).toBe(toBase64Url(rows[0]!.wrapped_vk_pw))
    expect(JSON.stringify(me)).not.toContain('authHash')
  })
})
