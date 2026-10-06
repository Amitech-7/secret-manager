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

  it('never shows server text and has a safe default', () => {
    expect(describeError(e('INTERNAL'))).not.toContain('server text')
    expect(describeError(new Error('postgres://secret@host'))).toBe(
      'Something went wrong. Please try again.',
    )
    expect(describeError('oops')).toBe('Something went wrong. Please try again.')
  })
})
