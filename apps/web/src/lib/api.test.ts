import { describe, expect, it } from 'vitest'
import { apiUrl } from './api'

describe('apiUrl', () => {
  it('is same-origin by default', () => {
    expect(apiUrl('/health', '')).toBe('/api/v1/health')
  })

  it('prefixes a configured base and tolerates slashes', () => {
    expect(apiUrl('health', 'https://example.com/')).toBe('https://example.com/api/v1/health')
  })
})
