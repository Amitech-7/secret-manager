import type { ErrorCode, ItemType, KdfParams } from '@sm/shared'

export class ApiRequestError extends Error {
  readonly code: ErrorCode | 'NETWORK'
  readonly status: number
  readonly retryAfter: number | undefined

  constructor(code: ErrorCode | 'NETWORK', message: string, status: number, retryAfter?: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface SaltResponse {
  kdfSalt: string
  kdfParams: KdfParams
}

export interface RegisterRequest {
  username: string
  authKey: string
  kdfSalt: string
  kdfParams: KdfParams
  wrappedVkPw: string
  wrappedVkRec: string
  recoveryAuth: string
  profileEnc?: string
  seedItems: Array<{ id: string; type: ItemType; ciphertext: string }>
  turnstileToken: string
}

export interface RegisterResponse extends TokenPair {
  userId: string
}

export interface LoginResponse extends TokenPair {
  wrappedVkPw: string
  kdfSalt: string
  kdfParams: KdfParams
  profileEnc: string | null
}

export interface MeResponse {
  username: string
  kdfSalt: string
  wrappedVkPw: string
  profileEnc: string | null
  totpEnabled: boolean
  itemCount: number
  itemQuota: number
  maxItemBytes: number
  kdfParams: KdfParams
  createdAt: string
}

export interface NewCredentials {
  newAuthKey: string
  newKdfSalt: string
  newKdfParams: KdfParams
  newWrappedVkPw: string
}

export interface RecoverBeginResponse {
  wrappedVkRec: string
  recoveryToken: string
  expiresIn: number
}

export interface ApiClientOptions {
  /** Empty for same-origin web; the full origin for the mobile app. */
  baseUrl?: string
  fetch?: typeof fetch
}

export function createApiClient(options: ApiClientOptions = {}) {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '')
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    let res: Response
    try {
      res = await doFetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new ApiRequestError('NETWORK', 'Could not reach the server', 0)
    }
    if (res.status === 204) return undefined as T
    const json = (await res.json().catch(() => null)) as {
      error?: { code?: ErrorCode; message?: string; retryAfter?: number }
    } | null
    if (!res.ok) {
      throw new ApiRequestError(
        json?.error?.code ?? 'INTERNAL',
        json?.error?.message ?? 'Request failed',
        res.status,
        json?.error?.retryAfter,
      )
    }
    return json as T
  }

  return {
    salt: (username: string) => call<SaltResponse>('POST', '/auth/salt', { username }),
    register: (body: RegisterRequest) => call<RegisterResponse>('POST', '/auth/register', body),
    login: (username: string, authKey: string) =>
      call<LoginResponse>('POST', '/auth/login', { username, authKey }),
    refresh: (refreshToken: string) => call<TokenPair>('POST', '/auth/refresh', { refreshToken }),
    logout: (refreshToken: string) => call<void>('POST', '/auth/logout', { refreshToken }),
    me: (accessToken: string) => call<MeResponse>('GET', '/me', undefined, accessToken),
    changePassword: (accessToken: string, body: NewCredentials & { currentAuthKey: string }) =>
      call<void>('POST', '/auth/password/change', body, accessToken),
    rotateRecovery: (
      accessToken: string,
      body: { currentAuthKey: string; newWrappedVkRec: string; newRecoveryAuth: string },
    ) => call<void>('POST', '/auth/recovery/rotate', body, accessToken),
    recoverBegin: (username: string, recoveryAuth: string) =>
      call<RecoverBeginResponse>('POST', '/auth/recover/begin', { username, recoveryAuth }),
    recoverComplete: (
      body: NewCredentials & {
        recoveryToken: string
        newWrappedVkRec: string
        newRecoveryAuth: string
      },
    ) => call<TokenPair>('POST', '/auth/recover/complete', body),
    deleteAccount: (accessToken: string, authKey: string) =>
      call<void>('DELETE', '/me', { authKey }, accessToken),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
