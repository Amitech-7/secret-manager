import { describe, expect, it } from 'vitest'
import { secureConnectionString } from './connection'

const sslmode = (s: string) => new URL(secureConnectionString(s)).searchParams.get('sslmode')

describe('secureConnectionString', () => {
  it('upgrades every weaker or missing mode to verify-full for remote hosts', () => {
    const base = 'postgresql://u:p@ep-x-pooler.eu.neon.tech/neondb'
    for (const q of [
      '',
      '?sslmode=require',
      '?sslmode=prefer',
      '?sslmode=verify-ca',
      '?sslmode=disable',
    ]) {
      expect(sslmode(base + q)).toBe('verify-full')
    }
  })

  it('drops the libpq-compat switch so it cannot weaken the mode', () => {
    const out = secureConnectionString(
      'postgresql://u:p@host.example/db?uselibpqcompat=true&sslmode=require',
    )
    expect(new URL(out).searchParams.has('uselibpqcompat')).toBe(false)
    expect(new URL(out).searchParams.get('sslmode')).toBe('verify-full')
  })

  it('keeps credentials, host, database and other parameters intact', () => {
    const out = new URL(
      secureConnectionString(
        'postgresql://sm_app:Abc123@ep-a-b-pooler.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      ),
    )
    expect(out.username).toBe('sm_app')
    expect(out.password).toBe('Abc123')
    expect(out.hostname).toBe('ep-a-b-pooler.region.aws.neon.tech')
    expect(out.pathname).toBe('/neondb')
    expect(out.searchParams.get('channel_binding')).toBe('require')
  })

  it('leaves loopback hosts alone so local databases without TLS still work', () => {
    for (const u of [
      'postgres://u:p@localhost:5432/db',
      'postgres://u:p@127.0.0.1/db',
      'postgres://u:p@[::1]:5432/db',
    ]) {
      expect(secureConnectionString(u)).toBe(u)
    }
  })

  it('rejects things that are not connection strings', () => {
    expect(() => secureConnectionString('not a url')).toThrow()
  })
})
