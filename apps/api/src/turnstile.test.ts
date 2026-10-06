import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTurnstileVerifier } from './turnstile'

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as Response)

afterEach(() => vi.restoreAllMocks())

describe('turnstile verifier', () => {
  it('passes only when Cloudflare says success is true', async () => {
    expect(await createTurnstileVerifier(() => 's', reply({ success: true }))('t', '1.2.3.4')).toBe(
      true,
    )
    expect(
      await createTurnstileVerifier(() => 's', reply({ success: false }))('t', '1.2.3.4'),
    ).toBe(false)
    expect(
      await createTurnstileVerifier(() => 's', reply({ success: 'true' }))('t', '1.2.3.4'),
    ).toBe(false)
    expect(await createTurnstileVerifier(() => 's', reply({}))('t', '1.2.3.4')).toBe(false)
  })

  it('fails closed on HTTP errors, network errors and a missing secret', async () => {
    expect(
      await createTurnstileVerifier(() => 's', reply({ success: true }, false))('t', 'ip'),
    ).toBe(false)
    const boom = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await createTurnstileVerifier(() => 's', boom)('t', 'ip')).toBe(false)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const never = reply({ success: true })
    expect(await createTurnstileVerifier(() => undefined, never)('t', 'ip')).toBe(false)
    expect(never).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })

  it('sends the secret, token and client IP to Cloudflare, and omits an unknown IP', async () => {
    const fetchMock = reply({ success: true })
    await createTurnstileVerifier(() => 'the-secret', fetchMock)('the-token', '9.9.9.9')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.body.get('secret')).toBe('the-secret')
    expect(init.body.get('response')).toBe('the-token')
    expect(init.body.get('remoteip')).toBe('9.9.9.9')

    const second = reply({ success: true })
    await createTurnstileVerifier(() => 's', second)('t', 'unknown')
    expect(
      (second.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body.has(
        'remoteip',
      ),
    ).toBe(false)
  })
})
