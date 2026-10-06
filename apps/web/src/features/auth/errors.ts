import { ApiRequestError } from '@sm/client'

/** Friendly text for the failures a person can act on. Details never include secrets. */
export function describeError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    switch (err.code) {
      case 'USERNAME_TAKEN':
        return 'That username is already taken. Choose another.'
      case 'CAPTCHA_FAILED':
        return 'The captcha check failed. Please try again.'
      case 'INVALID_CREDENTIALS':
        return 'Wrong username or password.'
      case 'RATE_LIMITED': {
        const minutes = Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))
        return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
      }
      case 'NETWORK':
        return 'Could not reach the server. Check your connection and try again.'
      case 'VALIDATION':
        return 'Some of the details are not valid. Please check them.'
      default:
        return 'Something went wrong. Please try again.'
    }
  }
  return 'Something went wrong. Please try again.'
}
