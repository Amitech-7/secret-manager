import {
  DEFAULT_KDF_PARAMS,
  deriveRecoveryKeys,
  generateRecoveryKey,
  importAesKey,
  parseRecoveryKey,
  randomSalt,
  rewrapVaultKey,
  toBase64Url,
  unwrapVaultKey,
  validateKdfParams,
  fromBase64Url,
  type KdfParams,
} from '@sm/crypto'
import type { ApiClient, NewCredentials } from './api'
import { directKdf, type AuthOptions, type KdfRunner, type Session } from './auth'

interface Common {
  api: ApiClient
  kdf?: KdfRunner
  /** Parameters for the new password's keys. Defaults to the current recommended settings. */
  kdfParams?: KdfParams
}

/** Derives keys for a password against the account's stored salt and parameters. */
async function deriveCurrent(
  opts: Common,
  me: { kdfSalt: string; kdfParams: KdfParams },
  password: string,
) {
  validateKdfParams(me.kdfParams)
  return (opts.kdf ?? directKdf)(password, fromBase64Url(me.kdfSalt), me.kdfParams)
}

/** Fresh salt and keys for a new password. */
async function deriveNew(opts: Common, password: string) {
  const salt = randomSalt()
  const params = opts.kdfParams ?? DEFAULT_KDF_PARAMS
  const keys = await (opts.kdf ?? directKdf)(password, salt, params)
  return { salt, params, keys }
}

/**
 * Change the master password. Re-wraps the vault key under keys from the new password, so no
 * item is re-encrypted. A wrong current password fails locally (the old wrapping will not open)
 * and, if it somehow got through, on the server. Other devices are signed out by the server.
 */
export async function changePassword(
  opts: Common & { accessToken: string; currentPassword: string; newPassword: string },
): Promise<void> {
  const me = await opts.api.me(opts.accessToken)
  const current = await deriveCurrent(opts, me, opts.currentPassword)
  const next = await deriveNew(opts, opts.newPassword)

  const newWrap = await rewrapVaultKey(
    fromBase64Url(me.wrappedVkPw),
    await importAesKey(current.wrapKey),
    'password',
    await importAesKey(next.keys.wrapKey),
    'password',
  )
  const body: NewCredentials & { currentAuthKey: string } = {
    currentAuthKey: toBase64Url(current.authKey),
    newAuthKey: toBase64Url(next.keys.authKey),
    newKdfSalt: toBase64Url(next.salt),
    newKdfParams: next.params,
    newWrappedVkPw: toBase64Url(newWrap),
  }
  for (const k of [current.authKey, current.wrapKey, next.keys.authKey, next.keys.wrapKey])
    k.fill(0)
  await opts.api.changePassword(opts.accessToken, body)
}

export interface PreparedRecoveryKeyChange {
  /** Shown once. The old recovery key keeps working until submit() succeeds. */
  recoveryKey: string
  submit(accessToken: string): Promise<void>
}

/** Replace the recovery key. Needs the master password: that is how the vault key is re-wrapped. */
export async function prepareRecoveryRotation(
  opts: Common & { accessToken: string; password: string },
): Promise<PreparedRecoveryKeyChange> {
  const me = await opts.api.me(opts.accessToken)
  const current = await deriveCurrent(opts, me, opts.password)
  const recovery = await generateRecoveryKey()
  const recoveryKeys = await deriveRecoveryKeys(recovery.key)

  const newWrapRec = await rewrapVaultKey(
    fromBase64Url(me.wrappedVkPw),
    await importAesKey(current.wrapKey),
    'password',
    await importAesKey(recoveryKeys.wrapKey),
    'recovery',
  )
  const body = {
    currentAuthKey: toBase64Url(current.authKey),
    newWrappedVkRec: toBase64Url(newWrapRec),
    newRecoveryAuth: toBase64Url(recoveryKeys.recoveryAuth),
  }
  for (const k of [current.authKey, current.wrapKey, recoveryKeys.wrapKey, recovery.key]) k.fill(0)
  return {
    recoveryKey: recovery.display,
    submit: (accessToken) => opts.api.rotateRecovery(accessToken, body),
  }
}

export async function deleteAccount(
  opts: Common & { accessToken: string; password: string },
): Promise<void> {
  const me = await opts.api.me(opts.accessToken)
  const current = await deriveCurrent(opts, me, opts.password)
  const authKey = toBase64Url(current.authKey)
  current.authKey.fill(0)
  current.wrapKey.fill(0)
  await opts.api.deleteAccount(opts.accessToken, authKey)
}

export interface PreparedRecovery {
  /** The replacement recovery key. Show it and make the person confirm it before submit(). */
  recoveryKey: string
  /** The server accepts the step-1 proof for this many seconds. */
  expiresIn: number
  submit(): Promise<Session>
}

/**
 * Forgot password. Step 1 proves possession of the recovery key and unlocks the vault key; the
 * caller then shows the replacement recovery key, and only submit() changes anything on the server.
 */
export async function prepareRecovery(
  opts: AuthOptions & Common & { username: string; recoveryKey: string; newPassword: string },
): Promise<PreparedRecovery> {
  const now = opts.now ?? Date.now
  const username = opts.username.trim().toLowerCase()
  const oldRecoveryKey = await parseRecoveryKey(opts.recoveryKey) // throws on a typo, before any request
  const oldKeys = await deriveRecoveryKeys(oldRecoveryKey)
  const begin = await opts.api.recoverBegin(username, toBase64Url(oldKeys.recoveryAuth))

  const oldWrap = await importAesKey(oldKeys.wrapKey)
  const wrappedVkRec = fromBase64Url(begin.wrappedVkRec)
  const vaultKey = await unwrapVaultKey(wrappedVkRec, oldWrap, 'recovery')

  const next = await deriveNew(opts, opts.newPassword)
  const fresh = await generateRecoveryKey()
  const freshKeys = await deriveRecoveryKeys(fresh.key)

  const newWrappedVkPw = await rewrapVaultKey(
    wrappedVkRec,
    oldWrap,
    'recovery',
    await importAesKey(next.keys.wrapKey),
    'password',
  )
  const newWrappedVkRec = await rewrapVaultKey(
    wrappedVkRec,
    oldWrap,
    'recovery',
    await importAesKey(freshKeys.wrapKey),
    'recovery',
  )
  const body = {
    recoveryToken: begin.recoveryToken,
    newAuthKey: toBase64Url(next.keys.authKey),
    newKdfSalt: toBase64Url(next.salt),
    newKdfParams: next.params,
    newWrappedVkPw: toBase64Url(newWrappedVkPw),
    newWrappedVkRec: toBase64Url(newWrappedVkRec),
    newRecoveryAuth: toBase64Url(freshKeys.recoveryAuth),
  }
  for (const k of [
    oldRecoveryKey,
    oldKeys.wrapKey,
    next.keys.authKey,
    next.keys.wrapKey,
    fresh.key,
    freshKeys.wrapKey,
  ]) {
    k.fill(0)
  }

  return {
    recoveryKey: fresh.display,
    expiresIn: begin.expiresIn,
    async submit() {
      const res = await opts.api.recoverComplete(body)
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
