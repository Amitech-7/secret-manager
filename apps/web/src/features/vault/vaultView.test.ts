import type { VaultItem } from '@sm/client'
import { describe, expect, it } from 'vitest'
import {
  accountInfo,
  confirmMatches,
  defaultMemberId,
  deleteBlockReason,
  filterCards,
  filterCredentials,
  formatCardNumber,
  formatMonth,
  isCardExpired,
  maskCardNumber,
  nameTaken,
  splitItems,
} from './vaultView'

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const base = { version: 1, createdAt: new Date(0), updatedAt: new Date(0) }
const item = (type: string, payload: object): VaultItem =>
  ({ id: id(), type, payload, ...base }) as unknown as VaultItem

const self = item('member', { name: 'Self' })
const mum = item('member', { name: 'Mum' })
const web = item('account_type', { name: 'Web' })
const bankType = item('account_type', { name: 'Bank' })
const google = item('account', { accountTypeId: web.id, name: 'Google' })
const zoho = item('account', { accountTypeId: web.id, name: 'Zoho' })
const sbiLogin = item('account', { accountTypeId: bankType.id, name: 'SBI' })
const sbi = item('bank', { name: 'SBI' })
const axis = item('bank', { name: 'Axis' })

const cred = (memberId: string, accountId: string, username: string) =>
  item('credential', { memberId, accountId, username, password: 'p' })
const card = (memberId: string, bankId: string, cardName: string) =>
  item('card', { memberId, bankId, cardName, nameOnCard: 'N', number: '4111111111110123' })

const c1 = cred(self.id, zoho.id, 'b-user')
const c2 = cred(self.id, google.id, 'z-user')
const c3 = cred(self.id, google.id, 'a-user')
const c4 = cred(mum.id, google.id, 'mum-user')
const c5 = cred(self.id, sbiLogin.id, 'netbank')
const k1 = card(self.id, sbi.id, 'Travel')
const k2 = card(self.id, axis.id, 'Daily')
const k3 = card(mum.id, sbi.id, 'Mum card')

const all: VaultItem[] = [
  self,
  mum,
  web,
  bankType,
  google,
  zoho,
  sbiLogin,
  sbi,
  axis,
  c1,
  c2,
  c3,
  c4,
  c5,
  k1,
  k2,
  k3,
]
const split = splitItems(all)

describe('grouping and defaults', () => {
  it('sorts reference lists by name and picks Self by default', () => {
    expect(split.members.map((m) => m.payload.name)).toEqual(['Mum', 'Self'])
    expect(split.banks.map((b) => b.payload.name)).toEqual(['Axis', 'SBI'])
    expect(defaultMemberId(split.members)).toBe(self.id)
    expect(defaultMemberId([mum] as never)).toBe(mum.id)
    expect(defaultMemberId([])).toBe('')
  })

  it('describes an account with its type, and survives a dangling id', () => {
    expect(accountInfo(split, google.id)).toEqual({ name: 'Google', typeName: 'Web' })
    expect(accountInfo(split, 'gone')).toEqual({ name: 'Unknown account', typeName: '' })
  })
})

describe('filters', () => {
  const ids = (xs: VaultItem[]) => xs.map((x) => x.id)

  it('shows one member at a time, grouped by account then username', () => {
    const r = filterCredentials(split, { memberId: self.id, accountTypeId: '', accountId: '' })
    expect(ids(r)).toEqual([c3.id, c2.id, c5.id, c1.id])
    expect(
      ids(filterCredentials(split, { memberId: mum.id, accountTypeId: '', accountId: '' })),
    ).toEqual([c4.id])
  })

  it('narrows by account type and by account', () => {
    expect(
      ids(
        filterCredentials(split, { memberId: self.id, accountTypeId: bankType.id, accountId: '' }),
      ),
    ).toEqual([c5.id])
    expect(
      ids(
        filterCredentials(split, {
          memberId: self.id,
          accountTypeId: web.id,
          accountId: google.id,
        }),
      ),
    ).toEqual([c3.id, c2.id])
    expect(
      ids(
        filterCredentials(split, {
          memberId: self.id,
          accountTypeId: bankType.id,
          accountId: google.id,
        }),
      ),
    ).toEqual([])
  })

  it('filters cards by member and bank', () => {
    expect(ids(filterCards(split, { memberId: self.id, bankId: '' }))).toEqual([k2.id, k1.id])
    expect(ids(filterCards(split, { memberId: self.id, bankId: sbi.id }))).toEqual([k1.id])
    expect(ids(filterCards(split, { memberId: mum.id, bankId: axis.id }))).toEqual([])
  })
})

describe('card formatting', () => {
  it('shows only the last four digits when masked', () => {
    expect(maskCardNumber('4111111111110123')).toBe('xxxx xxxx xxxx 0123')
    expect(maskCardNumber('378282246310005')).toBe('xxxx xxxx xxx 0005')
    expect(maskCardNumber('123')).toBe('123')
    expect(maskCardNumber('4111111111110123')).not.toContain('4111')
  })

  it('groups digits and formats months', () => {
    expect(formatCardNumber('4111111111111111')).toBe('4111 1111 1111 1111')
    expect(formatMonth('2030-09')).toBe('09/30')
    expect(formatMonth('')).toBe('')
  })

  it('treats a card as valid through the end of its expiry month', () => {
    expect(isCardExpired('2026-10', new Date('2026-10-31T23:59:59Z'))).toBe(false)
    expect(isCardExpired('2026-10', new Date('2026-11-01T00:00:00Z'))).toBe(true)
    expect(isCardExpired('', new Date())).toBe(false)
  })
})

describe('names and deletion', () => {
  it('detects duplicate names ignoring case and spaces', () => {
    const list = [
      { id: 'a', name: 'Google' },
      { id: 'b', name: 'Zoho' },
    ]
    expect(nameTaken(list, ' google ')).toBe(true)
    expect(nameTaken(list, 'google', 'a')).toBe(false)
    expect(nameTaken(list, 'Meta')).toBe(false)
  })

  it('confirms deletion only when the label is typed', () => {
    expect(confirmMatches('arjun.dev', ' Arjun.Dev ')).toBe(true)
    expect(confirmMatches('arjun.dev', 'arjun')).toBe(false)
    expect(confirmMatches('', '')).toBe(false)
  })

  it('blocks deleting anything still in use, and the last member', () => {
    expect(deleteBlockReason(all, self)).toMatch(/Still used by \d+ items/)
    expect(deleteBlockReason(all, google)).toBe('Still used by 3 items. Move or delete them first.')
    expect(deleteBlockReason(all, web)).toMatch(/Still used by 2 items/)
    expect(deleteBlockReason(all, k3)).toBeNull()
    const lone = item('member', { name: 'Self' })
    expect(deleteBlockReason([lone], lone)).toBe('Keep at least one member.')
    const unused = item('bank', { name: 'Unused' })
    expect(deleteBlockReason([...all, unused], unused)).toBeNull()
  })
})
