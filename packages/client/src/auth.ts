import {
  DEFAULT_KDF_PARAMS,
  decryptItem,
  deriveKeys,
  deriveRecoveryKeys,
  encryptItem,
  generateRecoveryKey,
  generateVaultKey,
  importAesKey,
  normalizeRecoveryInput,
  randomSalt,
  toBase64Url,
  unwrapVaultKey,
  validateKdfParams,
  wrapVaultKey,
  fromBase64Url,
  type DerivedKeys,
  type KdfParams,
} from '@sm/crypto'
import { ApiRequestError, type ApiClient } from './api'
import { buildSeed } from './seed'

/** Runs Argon2id. The web app swaps in a Web Worker so the page stays responsive. */
export type KdfRunner = (
  password: string,
  salt: Uint8Array,
  params: KdfParams,
) => Promise<DerivedKeys>

export const directKdf: KdfRunner = (password, salt, params) => deriveKeys(password, salt, params)

/** Everything lives in memory only. Closing the tab ends it. */
export interface Session {
  username: string
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds when the access token stops being accepted. */
  accessExpiresAt: number
  /** Non-extractable AES key: usable for this session's encrypt/decrypt, never readable. */
  vaultKey: CryptoKey
}

const normalizeUsername = (u: string) => u.trim().toLowerCase()

export interface AuthOptions {
  api: ApiClient
  kdf?: KdfRunner
  now?: () => number
}

export interface PreparedRegistration {
  /** Shown once to the user. Not sent to the server and not kept after submit. */
  recoveryKey: string
  submit(turnstileToken: string): Promise<Session>
}

/**
 * Phase 1 of registration: all the slow, secret work, with no network call and no account yet.
 * The caller shows the recovery key, makes the user confirm it, and only then calls submit().
 */
export async function prepareRegistration(
  options: AuthOptions & { username: string; password: string; kdfParams?: KdfParams },
): Promise<PreparedRegistration> {
  const { api, kdf = directKdf, now = Date.now } = options
  const username = normalizeUsername(options.username)
  const params = options.kdfParams ?? DEFAULT_KDF_PARAMS

  const salt = randomSalt()
  const keys = await kdf(options.password, salt, params)
  const vaultKeyBytes = generateVaultKey()
  const recovery = await generateRecoveryKey()
  const recoveryKeys = await deriveRecoveryKeys(recovery.key)

  const wrappedVkPw = await wrapVaultKey(
    vaultKeyBytes,
    await importAesKey(keys.wrapKey),
    'password',
  )
  const wrappedVkRec = await wrapVaultKey(
    vaultKeyBytes,
    await importAesKey(recoveryKeys.wrapKey),
    'recovery',
  )
  const vaultKey = await importAesKey(vaultKeyBytes)

  const seedItems = await Promise.all(
    buildSeed().map(async (item) => ({
      id: item.id,
      type: item.type,
      ciphertext: await encryptItem(vaultKey, { itemId: item.id, type: item.type }, item.payload),
    })),
  )

  const body = {
    username,
    authKey: toBase64Url(keys.authKey),
    kdfSalt: toBase64Url(salt),
    kdfParams: params,
    wrappedVkPw: toBase64Url(wrappedVkPw),
    wrappedVkRec: toBase64Url(wrappedVkRec),
    recoveryAuth: toBase64Url(recoveryKeys.recoveryAuth),
    seedItems,
  }

  // Raw secrets are wiped as soon as they are no longer needed.
  vaultKeyBytes.fill(0)
  keys.wrapKey.fill(0)
  recoveryKeys.wrapKey.fill(0)
  recovery.key.fill(0)

  return {
    recoveryKey: recovery.display,
    async submit(turnstileToken) {
      const res = await api.register({ ...body, turnstileToken })
      return {
        username,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        accessExpiresAt: now() + res.expiresIn * 1000,
        vaultKey,
      }
    },
  }
}

export async function login(
  options: AuthOptions & { username: string; password: string },
): Promise<Session> {
  const { api, kdf = directKdf, now = Date.now } = options
  const username = normalizeUsername(options.username)

  const { kdfSalt, kdfParams } = await api.salt(username)
  // The server chooses these values, so they are checked before any work is done with them.
  validateKdfParams(kdfParams)
  const keys = await kdf(options.password, fromBase64Url(kdfSalt), kdfParams)

  const res = await api.login(username, toBase64Url(keys.authKey))
  const vaultKey = await unwrapVaultKey(
    fromBase64Url(res.wrappedVkPw),
    await importAesKey(keys.wrapKey),
    'password',
  )
  keys.wrapKey.fill(0)
  keys.authKey.fill(0)

  return {
    username,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    accessExpiresAt: now() + res.expiresIn * 1000,
    vaultKey,
  }
}

const inflight = new WeakMap<Session, Promise<Session>>()

/** Rotates the refresh token. Concurrent callers share one request (a second would look like reuse). */
export function refreshSession(
  session: Session,
  options: Pick<AuthOptions, 'api' | 'now'>,
): Promise<Session> {
  const existing = inflight.get(session)
  if (existing) return existing
  const { api, now = Date.now } = options
  const promise = api
    .refresh(session.refreshToken)
    .then((res) => ({
      ...session,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      accessExpiresAt: now() + res.expiresIn * 1000,
    }))
    .finally(() => inflight.delete(session))
  inflight.set(session, promise)
  return promise
}

export async function logout(session: Session, options: Pick<AuthOptions, 'api'>): Promise<void> {
  await options.api.logout(session.refreshToken)
}

/**
 * Runs `fn` with a valid access token, refreshing first when it is about to expire and retrying
 * once if the server says it already has. Returns the (possibly renewed) session so the caller
 * can store it.
 */
export async function withFreshSession<T>(
  session: Session,
  options: Pick<AuthOptions, 'api' | 'now'>,
  fn: (accessToken: string) => Promise<T>,
): Promise<{ result: T; session: Session }> {
  const now = options.now ?? Date.now
  let current = session
  if (current.accessExpiresAt - now() < 30_000) current = await refreshSession(current, options)
  try {
    return { result: await fn(current.accessToken), session: current }
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'TOKEN_EXPIRED') {
      current = await refreshSession(current, options)
      return { result: await fn(current.accessToken), session: current }
    }
    throw err
  }
}

/** True when what the user typed matches the end of the displayed recovery key (at least 5 chars). */
export function confirmRecoveryTail(displayed: string, typed: string): boolean {
  const tail = normalizeRecoveryInput(typed)
  return tail.length >= 5 && normalizeRecoveryInput(displayed).endsWith(tail)
}

export { decryptItem }
