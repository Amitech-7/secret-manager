import { describe, expect, it } from 'vitest'
import { validatePayload } from './vault'

const id = () => crypto.randomUUID()

describe('validatePayload', () => {
  it('returns the cleaned payload when everything is fine', () => {
    const r = validatePayload('credential', {
      memberId: id(),
      accountId: id(),
      username: '  me ',
      password: ' keep spaces ',
    })
    expect(r.ok && r.payload).toMatchObject({ username: 'me', password: ' keep spaces ', hint: '' })
  })

  it('gives one readable message per bad field', () => {
    const r = validatePayload('credential', {
      memberId: '',
      accountId: id(),
      username: '',
      password: 'x'.repeat(101),
      hint: 'y'.repeat(101),
      expiryDate: '2026-02-30',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual({
      memberId: 'Choose a member.',
      username: 'Username is required.',
      password: 'Password is too long (at most 100 characters).',
      hint: 'Hint is too long (at most 100 characters).',
      expiryDate: 'Expiry date is not valid.',
    })
  })

  it('explains card fields in plain words', () => {
    const r = validatePayload('card', {
      memberId: id(),
      bankId: id(),
      cardName: 'c',
      nameOnCard: 'n',
      number: '12ab',
      expiryDate: '2030-13',
      cvv: '1',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual({
      number: 'Card number must be 8 to 19 digits.',
      expiryDate: 'Use month and year, like 2030-09.',
      cvv: 'CVV must be 3 to 5 digits.',
    })
  })

  it('treats a missing field as required', () => {
    const r = validatePayload('member', {})
    expect(!r.ok && r.errors).toEqual({ name: 'Name is required.' })
  })
})
