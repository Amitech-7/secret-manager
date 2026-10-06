import { createApp } from '@sm/api/app'
import { harness, type Harness } from '@sm/api/testkit'
import { CryptoError, decryptItem, fromBase64Url, toBase64Url, type KdfParams } from '@sm/crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiRequestError, createApiClient, type ApiClient } from './api'
import {
  confirmRecoveryTail,
  login,
  logout,
  prepareRegistration,
  refreshSession,
  withFreshSession,
  type Session,
} from './auth'
import { DEFAULT_KDF_PARAMS } from '@sm/shared'

/** Cheapest parameters the server accepts, to keep the suite fast. */
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
const freshIp = () => `10.9.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`

interface Logged {
  path: string
  body: string
}

/** A fetch that talks straight to the in-process server, pretending to come from `ip`. */
function appFetch(
  ip: string,
  log?: Logged[],
  rewrite?: (path: string, res: Response) => Promise<Response>,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    headers.set('x-real-ip', ip)
    log?.push({ path: url.pathname, body: typeof init?.body === 'string' ? init.body : '' })
    const res = await app.request(url.pathname + url.search, { ...init, headers })
    return rewrite ? rewrite(url.pathname, res) : res
  }
}

const clientAt = (ip = freshIp(), log?: Logged[]): ApiClient =>
  createApiClient({ baseUrl: 'http://localhost', fetch: appFetch(ip, log) })

let counter = 0
const newName = (prefix = 'user') => `${prefix}${++counter}`

async function signUp(username = newName(), password = PASSWORD, api = clientAt()) {
  const prepared = await prepareRegistration({ api, username, password, kdfParams: FAST })
  const session = await prepared.submit('captcha-ok')
  return { username, password, session, recoveryKey: prepared.recoveryKey }
}

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as ApiRequestError & CryptoError
  }
  throw new Error('expected a failure')
}

beforeAll(async () => {
  h = await harness({ DB_SIZE_LIMIT_MB: '512' })
  app = createApp(h.deps)
})
afterAll(async () => h.client.close())

describe('register and login (client crypto against the real server and database)', () => {
  it('registers, stores only ciphertext, and logs in with the same password', async () => {
    const { username, session } = await signUp()
    expect(session.username).toBe(username)

    const rows = await h.client.query<{ id: string; type: string; ciphertext: Uint8Array }>(
      `select i.id, i.type, i.ciphertext from vault_items i join users u on u.id = i.user_id where u.username = $1`,
      [username],
    )
    expect(rows.rows).toHaveLength(12)

    const second = await login({ api: clientAt(), username, password: PASSWORD })
    const decoded = await Promise.all(
      rows.rows.map((r) =>
        decryptItem(second.vaultKey, { itemId: r.id, type: r.type }, toBase64Url(r.ciphertext)),
      ),
    )
    expect(decoded).toContainEqual({ name: 'Self' })
    expect(decoded).toContainEqual({ name: 'Google', accountTypeId: expect.any(String) })

    // The database holds nothing readable: no seed name appears in any stored blob.
    for (const r of rows.rows)
      expect(Buffer.from(r.ciphertext).includes(Buffer.from('Self'))).toBe(false)
  })

  it('never sends the password, the recovery key or the vault key over the wire', async () => {
    const log: Logged[] = []
    const api = clientAt(freshIp(), log)
    const prepared = await prepareRegistration({
      api,
      username: newName(),
      password: PASSWORD,
      kdfParams: FAST,
    })
    await prepared.submit('captcha-ok')
    const wire = log.map((l) => l.body).join('\n')
    expect(wire).not.toContain(PASSWORD)
    expect(wire).not.toContain(prepared.recoveryKey)
    expect(wire).not.toContain(prepared.recoveryKey.replace(/-/g, ''))
    const body = JSON.parse(log.at(-1)!.body) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(
      [
        'authKey',
        'kdfParams',
        'kdfSalt',
        'recoveryAuth',
        'seedItems',
        'turnstileToken',
        'username',
        'wrappedVkPw',
        'wrappedVkRec',
      ].sort(),
    )
    expect(fromBase64Url(body.authKey as string)).toHaveLength(32)
  })

  it('accepts the real default KDF parameters (108 MiB) and stores them', async () => {
    const api = clientAt()
    const prepared = await prepareRegistration({
      api,
      username: newName('real'),
      password: PASSWORD,
    })
    const session = await prepared.submit('captcha-ok')
    expect((await api.me(session.accessToken)).kdfParams).toEqual(DEFAULT_KDF_PARAMS)
  })

  it('uses the stored KDF parameters at login, not the defaults', async () => {
    const { username } = await signUp()
    const salt = await clientAt().salt(username)
    expect(salt.kdfParams).toEqual(FAST)
    expect(salt.kdfParams).not.toEqual(DEFAULT_KDF_PARAMS)
  })

  it('registration is case-insensitive and rejects duplicates', async () => {
    const name = newName('Dup')
    await signUp(name)
    const again = await errorOf(signUp(name.toUpperCase()))
    expect(again.code).toBe('USERNAME_TAKEN')
    expect(again.status).toBe(409)
  })

  it('refuses registration when the captcha fails, and creates nothing', async () => {
    const name = newName('nocaptcha')
    h.captcha.passes = false
    const err = await errorOf(signUp(name))
    h.captcha.passes = true
    expect(err.code).toBe('CAPTCHA_FAILED')
    const { rows } = await h.client.query(`select 1 from users where username = $1`, [name])
    expect(rows).toHaveLength(0)
  })
})

describe('wrong credentials and enumeration', () => {
  it('answers a wrong password and an unknown user identically', async () => {
    const { username } = await signUp()
    const wrong = await errorOf(
      login({ api: clientAt(), username, password: 'a different long passphrase!' }),
    )
    const unknown = await errorOf(
      login({ api: clientAt(), username: newName('ghost'), password: PASSWORD }),
    )
    for (const e of [wrong, unknown]) {
      expect(e.code).toBe('INVALID_CREDENTIALS')
      expect(e.status).toBe(401)
    }
    expect(wrong.message).toBe(unknown.message)
  })

  it('serves a stable fake salt for unknown users that looks like a real answer', async () => {
    const api = clientAt()
    const ghost = newName('ghost')
    const a = await api.salt(ghost)
    const b = await clientAt().salt(ghost)
    expect(a).toEqual(b)
    expect(fromBase64Url(a.kdfSalt)).toHaveLength(16)
    expect(a.kdfParams).toEqual(DEFAULT_KDF_PARAMS)
    expect((await clientAt().salt(newName('ghost'))).kdfSalt).not.toBe(a.kdfSalt)
  })

  it('returns the registered salt for a real user', async () => {
    const { username } = await signUp()
    const { rows } = await h.client.query<{ kdf_salt: Uint8Array }>(
      `select kdf_salt from users where username = $1`,
      [username],
    )
    expect((await clientAt().salt(username)).kdfSalt).toBe(toBase64Url(rows[0]!.kdf_salt))
  })

  it('stores a SHA-256 of the auth key, never the key itself', async () => {
    const log: Logged[] = []
    const api = clientAt(freshIp(), log)
    const name = newName()
    await (
      await prepareRegistration({ api, username: name, password: PASSWORD, kdfParams: FAST })
    ).submit('x')
    const sent = (JSON.parse(log.at(-1)!.body) as { authKey: string }).authKey
    const { rows } = await h.client.query<{ auth_hash: Uint8Array }>(
      `select auth_hash from users where username = $1`,
      [name],
    )
    expect(Buffer.from(rows[0]!.auth_hash).equals(Buffer.from(sent, 'base64url'))).toBe(false)
    const { createHash } = await import('node:crypto')
    expect(
      Buffer.from(rows[0]!.auth_hash).equals(
        createHash('sha256').update(Buffer.from(sent, 'base64url')).digest(),
      ),
    ).toBe(true)
  })

  it('refuses downgraded KDF parameters from the server before doing any work', async () => {
    const { username } = await signUp()
    const log: Logged[] = []
    const evil = createApiClient({
      baseUrl: 'http://localhost',
      fetch: appFetch(freshIp(), log, async (path, res) => {
        if (path !== '/api/v1/auth/salt') return res
        const body = (await res.json()) as { kdfParams: KdfParams }
        return Response.json({ ...body, kdfParams: { ...body.kdfParams, memoryKiB: 1024 } })
      }),
    })
    const err = await errorOf(login({ api: evil, username, password: PASSWORD }))
    expect(err.code).toBe('INVALID_PARAMS')
    expect(log.some((l) => l.path.endsWith('/auth/login'))).toBe(false)
  })
})

describe('sessions', () => {
  it('/me works with a valid token and rejects missing or garbage tokens', async () => {
    const { session, username } = await signUp()
    const api = clientAt()
    const me = await api.me(session.accessToken)
    expect(me).toMatchObject({
      username,
      itemCount: 12,
      itemQuota: 1000,
      maxItemBytes: 8192,
      totpEnabled: false,
      kdfParams: FAST,
    })
    expect((await errorOf(api.me(''))).code).toBe('UNAUTHENTICATED')
    expect((await errorOf(api.me('a.b.c'))).code).toBe('UNAUTHENTICATED')
  })

  it('rotates refresh tokens, and replaying an old one ends the whole session', async () => {
    const { session } = await signUp()
    const api = clientAt()
    const rotated = await refreshSession(session, { api })
    expect(rotated.refreshToken).not.toBe(session.refreshToken)
    expect(rotated.vaultKey).toBe(session.vaultKey)
    await expect(api.me(rotated.accessToken)).resolves.toBeDefined()

    const replay = await errorOf(refreshSession({ ...session }, { api }))
    expect(replay.code).toBe('UNAUTHENTICATED')
    // The legitimate holder is cut off too, and so is the access token that was still unexpired.
    expect((await errorOf(refreshSession(rotated, { api }))).code).toBe('UNAUTHENTICATED')
    expect((await errorOf(api.me(rotated.accessToken))).code).toBe('UNAUTHENTICATED')
  })

  it('concurrent refreshes share one request instead of tripping reuse detection', async () => {
    const { session } = await signUp()
    const api = clientAt()
    const [a, b] = await Promise.all([
      refreshSession(session, { api }),
      refreshSession(session, { api }),
    ])
    expect(a).toBe(b)
    await expect(api.me(a.accessToken)).resolves.toBeDefined()
  })

  it('logout ends the session immediately, even for an unexpired access token', async () => {
    const { session } = await signUp()
    const api = clientAt()
    await logout(session, { api })
    expect((await errorOf(api.me(session.accessToken))).code).toBe('UNAUTHENTICATED')
    expect((await errorOf(refreshSession(session, { api }))).code).toBe('UNAUTHENTICATED')
    await expect(logout(session, { api })).resolves.toBeUndefined()
  })

  it('access tokens expire after 15 minutes and a refresh issues a working one', async () => {
    const { session } = await signUp()
    const api = clientAt()
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60_000)
    expect((await errorOf(api.me(session.accessToken))).code).toBe('TOKEN_EXPIRED')
    const renewed = await refreshSession(session, { api })
    await expect(api.me(renewed.accessToken)).resolves.toBeDefined()
  })

  it('withFreshSession refreshes before expiry, retries once on an expired token, and returns the new session', async () => {
    const { session } = await signUp()
    const api = clientAt()
    const direct = await withFreshSession(session, { api }, (t) => api.me(t))
    expect(direct.session).toBe(session)

    // Within 30 s of expiry: refreshed up front.
    const soon = { ...session, accessExpiresAt: Date.now() + 10_000 }
    const early = await withFreshSession(soon, { api }, (t) => api.me(t))
    expect(early.session.refreshToken).not.toBe(session.refreshToken)

    // Looks valid locally but the server clock disagrees: one retry after a refresh.
    const { session: other } = await signUp()
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60_000)
    const late = await withFreshSession(
      { ...other, accessExpiresAt: Date.now() + 3_600_000 },
      { api },
      (t) => api.me(t),
    )
    expect(late.session.refreshToken).not.toBe(other.refreshToken)
    expect(late.result.username).toBe(other.username)
  })

  it('refresh tokens stop working after 30 days', async () => {
    const { session } = await signUp()
    h.clock.now = new Date(h.clock.now.getTime() + 31 * 86_400_000)
    expect((await errorOf(refreshSession(session, { api: clientAt() }))).code).toBe(
      'UNAUTHENTICATED',
    )
  })

  it('keeps at most 10 sessions per user, dropping the oldest', async () => {
    const { username, session: first } = await signUp()
    let latest: Session = first
    for (let i = 0; i < 10; i++) {
      h.clock.now = new Date(h.clock.now.getTime() + 1000)
      latest = await login({ api: clientAt(), username, password: PASSWORD })
    }
    const { rows } = await h.client.query<{ n: number }>(
      `select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.username = $1`,
      [username],
    )
    expect(rows[0]!.n).toBe(10)
    expect((await errorOf(refreshSession(first, { api: clientAt() }))).code).toBe('UNAUTHENTICATED')
    await expect(refreshSession(latest, { api: clientAt() })).resolves.toBeDefined()
  })
})

describe('request validation on the server', () => {
  const baseBody = async () => {
    const log: Logged[] = []
    const api = clientAt(freshIp(), log)
    const prepared = await prepareRegistration({
      api,
      username: newName('val'),
      password: PASSWORD,
      kdfParams: FAST,
    })
    await prepared.submit('x')
    return JSON.parse(log.at(-1)!.body) as Record<string, unknown> & { seedItems: unknown[] }
  }
  const post = (body: unknown) =>
    app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': freshIp() },
      body: JSON.stringify(body),
    })

  it('rejects malformed, oversized, weak or unknown fields with a 400', async () => {
    const good = await baseBody()
    const variants: Record<string, unknown> = {
      'short username': { ...good, username: 'ab' },
      'bad characters': { ...good, username: 'has space' },
      'wrong auth key size': { ...good, authKey: toBase64Url(new Uint8Array(31)) },
      'wrong wrapped key size': { ...good, wrappedVkPw: toBase64Url(new Uint8Array(60)) },
      'weak memory': { ...good, kdfParams: { ...FAST, memoryKiB: 1024 } },
      'weak iterations': { ...good, kdfParams: { ...FAST, iterations: 1 } },
      'unknown field': { ...good, isAdmin: true },
      'too many seed items': {
        ...good,
        seedItems: Array.from({ length: 51 }, () => good.seedItems[0]),
      },
      'duplicate seed ids': { ...good, seedItems: [good.seedItems[0], good.seedItems[0]] },
      'seed with a bad type': {
        ...good,
        seedItems: [{ ...(good.seedItems[0] as object), type: 'password' }],
      },
      'seed too short': {
        ...good,
        seedItems: [
          { ...(good.seedItems[0] as object), ciphertext: toBase64Url(new Uint8Array(10)) },
        ],
      },
      'missing captcha token': { ...good, turnstileToken: '' },
    }
    for (const [label, body] of Object.entries(variants)) {
      const res = await post(body)
      expect(res.status, label).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code, label).toBe(
        'VALIDATION',
      )
    }
  })

  it('does not echo the submitted values back', async () => {
    const good = await baseBody()
    const res = await post({ ...good, authKey: 'secret-looking-value' })
    expect(JSON.stringify(await res.json())).not.toContain('secret-looking-value')
  })

  it('control: a well-formed body for a taken username is a 409, not a 400', async () => {
    const good = await baseBody()
    expect((await post(good)).status).toBe(409)
  })
})

describe('rate limiting', () => {
  it('limits login attempts per IP', async () => {
    const api = clientAt('203.0.113.7')
    let last = 0
    for (let i = 0; i < 11; i++) {
      const e = await errorOf(api.login(newName('burst'), toBase64Url(new Uint8Array(32))))
      last = e.status
    }
    expect(last).toBe(429)
  })

  it('limits attempts per username across many IPs, whether or not the user exists', async () => {
    const { username } = await signUp()
    const results: number[] = []
    for (let i = 0; i < 11; i++) {
      const e = await errorOf(clientAt(freshIp()).login(username, toBase64Url(new Uint8Array(32))))
      results.push(e.status)
    }
    expect(results.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(results[10]).toBe(429)

    const ghost = newName('ghost')
    const ghostResults: number[] = []
    for (let i = 0; i < 11; i++) {
      ghostResults.push(
        (await errorOf(clientAt(freshIp()).login(ghost, toBase64Url(new Uint8Array(32))))).status,
      )
    }
    expect(ghostResults).toEqual(results)
  })

  it('a locked-out username cannot log in even with the right password, until the window passes', async () => {
    const { username } = await signUp()
    for (let i = 0; i < 10; i++)
      await errorOf(clientAt(freshIp()).login(username, toBase64Url(new Uint8Array(32))))
    const blocked = await errorOf(login({ api: clientAt(freshIp()), username, password: PASSWORD }))
    expect(blocked.status).toBe(429)
    expect(blocked.retryAfter).toBeGreaterThan(0)
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60_000)
    await expect(
      login({ api: clientAt(freshIp()), username, password: PASSWORD }),
    ).resolves.toBeDefined()
  })

  it('allows only 3 registrations per hour from one IP', async () => {
    const ip = '198.51.100.9'
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      try {
        await signUp(newName('flood'), PASSWORD, clientAt(ip))
        statuses.push(201)
      } catch (e) {
        statuses.push((e as ApiRequestError).status)
      }
    }
    expect(statuses).toEqual([201, 201, 201, 429])
  })
})

describe('recovery key confirmation', () => {
  it('accepts the last characters in any case and with look-alikes, and rejects wrong or short input', () => {
    const shown = '000G4-0R40M-30E20-9185G-R38E1-W8124-GK2GA-HC5RR-34D1P-70X3R-FV9A0'
    expect(confirmRecoveryTail(shown, 'FV9A0')).toBe(true)
    expect(confirmRecoveryTail(shown, 'fv9ao')).toBe(true)
    expect(confirmRecoveryTail(shown, '70x3r-fv9a0')).toBe(true)
    expect(confirmRecoveryTail(shown, 'FV9A1')).toBe(false)
    expect(confirmRecoveryTail(shown, 'V9A0')).toBe(false)
    expect(confirmRecoveryTail(shown, '')).toBe(false)
  })
})
