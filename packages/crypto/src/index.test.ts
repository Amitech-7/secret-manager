import { expect, it } from 'vitest'
import { PACKAGE } from './index'

it('is wired into the workspace', () => {
  expect(PACKAGE).toBe('@sm/crypto')
})
