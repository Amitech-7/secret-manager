import { ApiRequestError } from '@sm/client'
import { describe, expect, it } from 'vitest'
import { describeError } from './errors'

const e = (code: ConstructorParameters<typeof ApiRequestError>[0], retryAfter?: number) =>
  new ApiRequestError(code, 'server text that must not be shown', 400, retryAfter)

describe('describeError', () => {
  it('explains the actionable cases', () => {
    expect(describeError(e('USERNAME_TAKEN'))).toContain('taken')
    expect(describeError(e('INVALID_CREDENTIALS'))).toBe('Wrong username or password.')
    expect(describeError(e('CAPTCHA_FAILED'))).toContain('captcha')
    expect(describeError(e('NETWORK'))).toContain('connection')
  })

  it('turns retry-after seconds into whole minutes', () => {
    expect(describeError(e('RATE_LIMITED', 30))).toContain('1 minute.')
    expect(describeError(e('RATE_LIMITED', 600))).toContain('10 minutes.')
    expect(describeError(e('RATE_LIMITED'))).toContain('1 minute.')
  })

  it('explains local cryptographic failures without leaking details', () => {
    const crypto = (code: string) => Object.assign(new Error('internal detail'), { code })
    expect(describeError(crypto('INVALID_RECOVERY_KEY'))).toContain('recovery key')
    expect(describeError(crypto('DECRYPT_FAILED'))).toContain('password is wrong')
    expect(describeError(crypto('SOMETHING_ELSE'))).toBe('Something went wrong. Please try again.')
    expect(describeError(crypto('DECRYPT_FAILED'))).not.toContain('internal detail')
  })

  it('treats an expired or spent step as "start again"', () => {
    expect(describeError(e('TOKEN_EXPIRED'))).toContain('start again')
    expect(describeError(e('UNAUTHENTICATED'))).toContain('start again')
  })

  it('never shows server text and has a safe default', () => {
    expect(describeError(e('INTERNAL'))).not.toContain('server text')
    expect(describeError(new Error('postgres://secret@host'))).toBe(
      'Something went wrong. Please try again.',
    )
    expect(describeError('oops')).toBe('Something went wrong. Please try again.')
  })
})
