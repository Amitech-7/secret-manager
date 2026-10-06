import type { Database } from '@sm/db'
import type { Env } from './env'
import type { TurnstileVerifier } from './turnstile'

/**
 * Everything the app needs from the outside world. Getters are lazy so that /health works even
 * when the environment is incomplete, and so tests can inject an in-process database and clock.
 */
export interface Deps {
  getEnv: () => Env
  getDb: () => Database
  now: () => Date
  verifyTurnstile: TurnstileVerifier
}

export type AppEnv = { Variables: { deps: Deps } }
