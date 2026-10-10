import { describe, expect, it } from 'vitest'
import { ImportError, MAX_IMPORT_ITEMS, planImport, type RawImportItem } from './importPlan'
import type { VaultItem } from './vault'

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const base = { version: 3, createdAt: new Date(0), updatedAt: new Date(0) }
const have = (type: string, payload: object): VaultItem =>
  ({ id: uuid(), type, payload, ...base }) as unknown as VaultItem
const file = (type: string, payload: object, id = uuid()): RawImportItem => ({ id, type, payload })
const ids = () => {
  let i = 0
  return () => `99999999-0000-4000-8000-${String(++i).padStart(12, '0')}`
}

// A vault that already has the starter lists.
const self = have('member', { name: 'Self' })
const web = have('account_type', { name: 'Web' })
const google = have('account', { accountTypeId: web.id, name: 'Google' })
const misc = have('bank', { name: 'Misc' })
const mine = [self, web, google, misc]

// The same lists as they appear in a backup from a different account (different ids).
const fSelf = file('member', { name: 'self' })
const fWeb = file('account_type', { name: 'Web' })
const fGoogle = file('account', { accountTypeId: fWeb.id, name: 'Google' })
const fBank = file('bank', { name: 'Misc' })
const cred = (over: object = {}) =>
  file('credential', {
    memberId: fSelf.id,
    accountId: fGoogle.id,
    username: 'arjun',
    password: 'pw',
    ...over,
  })
const card = (over: object = {}) =>
  file('card', {
    memberId: fSelf.id,
    bankId: fBank.id,
    cardName: 'Travel',
    nameOnCard: 'ARJUN',
    number: '4111 1111 1111 1111',
    expiryDate: '2030-09',
    cvv: '123',
    ...over,
  })

describe('importing a backup from another account', () => {
  it('merges lists by name, re-points items, and creates only what is new', () => {
    const c = cred()
    const k = card()
    const plan = planImport(mine, 4, [fSelf, fWeb, fGoogle, fBank, c, k], ids())
    expect(plan.merged).toBe(4)
    expect(plan.creates.map((x) => x.type)).toEqual(['credential', 'card'])
    expect(plan.creates[0]!.payload).toMatchObject({ memberId: self.id, accountId: google.id })
    expect(plan.creates[1]!.payload).toMatchObject({
      memberId: self.id,
      bankId: misc.id,
      number: '4111111111111111',
    })
    expect(plan.invalid).toEqual([])
    expect(plan.overQuota).toBe(false)
  })

  it('creates lists that do not exist yet, before the items that use them', () => {
    const mum = file('member', { name: 'Mum' })
    const mumCred = cred({ memberId: mum.id })
    const plan = planImport(mine, 4, [mumCred, fSelf, fWeb, fGoogle, mum], ids())
    expect(plan.creates.map((x) => x.type)).toEqual(['member', 'credential'])
    const newMember = plan.creates[0]!
    expect(plan.creates[1]!.payload.memberId).toBe(newMember.id)
  })

  it('merges accounts by name only within the same account type', () => {
    const bankType = file('account_type', { name: 'Bank' })
    const bankGoogle = file('account', { accountTypeId: bankType.id, name: 'Google' })
    const plan = planImport(mine, 4, [fWeb, bankType, fGoogle, bankGoogle], ids())
    expect(plan.merged).toBe(2) // Web and Google under Web
    expect(plan.creates.map((x) => x.type)).toEqual(['account_type', 'account'])
  })
})

describe('importing the same data again', () => {
  const credential = have('credential', {
    memberId: self.id,
    accountId: google.id,
    username: 'arjun',
    password: 'pw',
    hint: '',
    remark: '',
    expiryDate: '',
  })
  const sameInFile = (over: object = {}) =>
    file(
      'credential',
      { memberId: self.id, accountId: google.id, username: 'arjun', password: 'pw', ...over },
      credential.id,
    )

  it('does nothing when everything is already there', () => {
    const plan = planImport([...mine, credential], 5, [sameInFile()], ids())
    expect(plan).toMatchObject({ unchanged: 1, creates: [], updates: [], invalid: [] })
  })

  it('finds the same item by content even when the id differs', () => {
    const plan = planImport([...mine, credential], 5, [{ ...sameInFile(), id: uuid() }], ids())
    expect(plan).toMatchObject({ unchanged: 1, creates: [], updates: [] })
  })

  it('treats a different capitalisation of the username as the same login, with a change', () => {
    const plan = planImport(
      [...mine, credential],
      5,
      [{ ...sameInFile({ username: 'Arjun' }), id: uuid() }],
      ids(),
    )
    expect(plan.creates).toEqual([])
    expect(plan.updates).toHaveLength(1)
  })

  it('reports a changed password as an update, not a new item', () => {
    const plan = planImport([...mine, credential], 5, [sameInFile({ password: 'older' })], ids())
    expect(plan.creates).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]!.existing.id).toBe(credential.id)
    expect(plan.updates[0]!.payload.password).toBe('older')
  })

  it('reports a renamed list entry as an update when the id matches', () => {
    const renamed = { ...file('member', { name: 'Me' }), id: self.id }
    const plan = planImport(mine, 4, [renamed], ids())
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]!.payload.name).toBe('Me')
  })
})

describe('bad input', () => {
  it('rejects bad items with a reason and keeps the good ones', () => {
    const good = cred()
    const plan = planImport(
      mine,
      4,
      [
        fSelf,
        fWeb,
        fGoogle,
        good,
        file('note', { text: 'x' }),
        file('credential', {
          memberId: fSelf.id,
          accountId: fGoogle.id,
          username: '',
          password: 'p',
        }),
        file('credential', {
          memberId: uuid(),
          accountId: fGoogle.id,
          username: 'x',
          password: 'p',
        }),
        file('card', { ...(card().payload as object), bankId: uuid() }),
        { id: 'not-a-uuid', type: 'member', payload: { name: 'X' } },
        { ...good }, // same id twice
      ],
      ids(),
    )
    expect(plan.creates.map((c) => c.type)).toEqual(['credential'])
    expect(plan.invalid.map((i) => i.reason)).toEqual(
      expect.arrayContaining([
        'Has no valid id.',
        'Appears twice in the file.',
        'Unknown kind of item.',
        'Username is required.',
        'Refers to a member that is not in the file.',
        'Refers to a bank that is not in the file.',
      ]),
    )
  })

  it('flags two file items that are the same credential', () => {
    const a = cred({ password: 'one' })
    const b = cred({ password: 'two' })
    const plan = planImport(mine, 4, [fSelf, fWeb, fGoogle, a, b], ids())
    expect(plan.creates).toHaveLength(1)
    expect(plan.invalid).toHaveLength(1)
    expect(plan.invalid[0]!.reason).toBe('Duplicates another item in the file.')
  })

  it('never reports secrets in a rejection', () => {
    const plan = planImport(
      mine,
      4,
      [file('credential', { password: 'SuperSecret!' }, uuid())],
      ids(),
    )
    expect(JSON.stringify(plan.invalid)).not.toContain('SuperSecret')
  })

  it('refuses an enormous file outright', () => {
    const many = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, () => fSelf)
    expect(() => planImport(mine, 4, many)).toThrow(ImportError)
  })
})

describe('quota', () => {
  it('flags an import that would pass the limit', () => {
    const members = Array.from({ length: 10 }, (_, i) => file('member', { name: `M${i}` }))
    expect(planImport([], 995, members, ids()).overQuota).toBe(true)
    expect(planImport([], 990, members, ids()).overQuota).toBe(false)
  })
})
