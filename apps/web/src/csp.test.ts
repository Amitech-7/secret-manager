import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guards the security headers in vercel.json and the page itself. The headers cannot be tested in
 * a browser here (Vercel adds them), so these tests pin the policy down and stop the page from
 * quietly gaining things the policy forbids.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const config = JSON.parse(read('../../../vercel.json')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
}
const headers = Object.fromEntries(
  config.headers.flatMap((g) => g.headers).map((h) => [h.key, h.value]),
)

const parse = (policy: string): Map<string, string[]> =>
  new Map(
    policy
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/)
        return [name!, values] as const
      }),
  )

const enforced = parse(headers['Content-Security-Policy'] ?? '')
const full = parse(
  headers['Content-Security-Policy-Report-Only'] ?? headers['Content-Security-Policy'] ?? '',
)

describe('vercel.json headers', () => {
  it('applies to every path', () => {
    expect(config.headers.map((g) => g.source)).toContain('/(.*)')
  })

  it('always enforces the directives that cannot break the app', () => {
    expect(enforced.get('frame-ancestors')).toEqual(["'none'"])
    expect(enforced.get('object-src')).toEqual(["'none'"])
    expect(enforced.get('base-uri')).toEqual(["'none'"])
    expect(enforced.get('form-action')).toEqual(["'none'"])
    expect(enforced.has('upgrade-insecure-requests')).toBe(true)
  })

  it('the full policy denies by default and allows only what the app uses', () => {
    expect(full.get('default-src')).toEqual(["'none'"])
    expect(full.get('script-src')).toEqual([
      "'self'",
      "'wasm-unsafe-eval'", // Argon2id is WebAssembly
      'https://challenges.cloudflare.com', // Turnstile
    ])
    expect(full.get('frame-src')).toEqual(['https://challenges.cloudflare.com'])
    expect(full.get('connect-src')).toEqual(["'self'"])
    expect(full.get('worker-src')).toEqual(["'self'"]) // the key-derivation worker
    expect(full.get('style-src')).toEqual(["'self'"])
  })

  it('never allows inline or eval code, or wildcards', () => {
    const all = [...full.values()].flat()
    for (const banned of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'unsafe-hashes'",
      '*',
      'data:',
      'blob:',
      'http:',
    ]) {
      expect(all, banned).not.toContain(banned)
    }
    for (const value of all) expect(value).not.toMatch(/\*/)
  })

  it('sets the other hardening headers', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin')
    const hsts = headers['Strict-Transport-Security'] ?? ''
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31_536_000)
    const permissions = headers['Permissions-Policy'] ?? ''
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(permissions).toContain(`${feature}=()`)
    }
  })

  it('does not block the clipboard, which the copy buttons need', () => {
    expect(headers['Permissions-Policy']).not.toMatch(/clipboard/)
  })
})

describe('index.html', () => {
  const html = read('../index.html')

  it('has no inline scripts, handlers or styles that the policy would block', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc="/)
      expect(body?.trim()).toBe('')
    }
    expect(html).not.toMatch(/<style\b/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/\sstyle\s*=/i)
  })

  it('loads nothing from other sites', () => {
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//)
  })
})
