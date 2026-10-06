import { describe, expect, it } from 'vitest'
import { buildSeed } from './seed'

describe('buildSeed', () => {
  it('creates the default vault with unique ids and consistent references', () => {
    let n = 0
    const items = buildSeed(() => `id-${n++}`)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(items.filter((i) => i.type === 'member').map((i) => i.payload.name)).toEqual(['Self'])
    const types = items.filter((i) => i.type === 'account_type')
    expect(types.map((t) => t.payload.name)).toEqual([
      'Web',
      'Bank',
      'Academic',
      'Social Media',
      'Misc',
    ])
    const accounts = items.filter((i) => i.type === 'account')
    expect(accounts.map((a) => a.payload.name)).toEqual([
      'Google',
      'Microsoft',
      'Zoho',
      'Meta',
      'Misc',
    ])
    const typeIds = new Set(types.map((t) => t.id))
    for (const a of accounts) expect(typeIds.has(a.payload.accountTypeId!)).toBe(true)
    expect(items.filter((i) => i.type === 'bank').map((b) => b.payload.name)).toEqual(['Misc'])
    expect(items.length).toBeLessThanOrEqual(50)
  })

  it('uses real UUIDs by default', () => {
    for (const item of buildSeed()) expect(item.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
