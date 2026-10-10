import { ImportError, type ImportPlan } from '@sm/client'
import { CryptoError } from '@sm/crypto'
import { describe, expect, it } from 'vitest'
import { describeBackupError, plural, summarizePlan } from './backupView'

const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  creates: [],
  updates: [],
  unchanged: 0,
  merged: 0,
  invalid: [],
  occupied: 0,
  overQuota: false,
  ...over,
})
const create = (type: string) => ({ type, id: 'x', payload: {} }) as never

describe('summarizePlan', () => {
  it('counts what will be added, what is already there and what is skipped', () => {
    const s = summarizePlan(
      plan({
        creates: [
          create('member'),
          create('credential'),
          create('credential'),
          create('card'),
          create('bank'),
        ],
        unchanged: 3,
        merged: 12,
        updates: [{} as never],
        invalid: [{ id: 'a', type: 'x', reason: 'r' }],
      }),
    )
    expect(s).toEqual({
      newCredentials: 2,
      newCards: 1,
      newListEntries: 2,
      alreadyThere: 15,
      different: 1,
      skipped: 1,
      total: 5,
    })
  })
})

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'credential')).toBe('1 credential')
    expect(plural(0, 'credential')).toBe('0 credentials')
    expect(plural(2, 'card')).toBe('2 cards')
    expect(plural(1, 'list entry', 'list entries')).toBe('1 list entry')
    expect(plural(3, 'list entry', 'list entries')).toBe('3 list entries')
  })
})

describe('describeBackupError', () => {
  it('explains the failures a person can act on', () => {
    expect(describeBackupError(new CryptoError('WEAK_PASSPHRASE', 'x'))).toContain('12 characters')
    expect(describeBackupError(new CryptoError('DECRYPT_FAILED', 'x'))).toBe(
      'Wrong passphrase, or the file is damaged.',
    )
    expect(describeBackupError(new CryptoError('INVALID_FORMAT', 'x'))).toContain(
      'not a Secret Manager',
    )
    expect(describeBackupError(new ImportError('OVER_QUOTA', 'x'))).toContain('1,000')
    expect(describeBackupError(new ImportError('TOO_MANY', 'x'))).toContain('too many')
    expect(describeBackupError(new RangeError('FILE_TOO_LARGE'))).toContain('too large')
  })

  it('falls back to the general messages', () => {
    expect(describeBackupError(new Error('boom'))).toBe(describeBackupError(new Error('other')))
  })
})
