export type TurnstileVerifier = (token: string, ip: string) => Promise<boolean>

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Fails closed: with no secret configured, registration is refused rather than left open to
 * bots. For local development use Cloudflare's published always-pass test keys.
 */
export function createTurnstileVerifier(
  getSecret: () => string | undefined,
  fetchImpl: typeof fetch = fetch,
): TurnstileVerifier {
  return async (token, ip) => {
    const secret = getSecret()
    if (!secret) {
      console.error('TURNSTILE_SECRET is not set: refusing registration')
      return false
    }
    const body = new URLSearchParams({ secret, response: token })
    if (ip !== 'unknown') body.set('remoteip', ip)
    try {
      const res = await fetchImpl(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return false
      const json = (await res.json()) as { success?: unknown }
      return json.success === true
    } catch {
      return false
    }
  }
}
