import { CryptoError } from '@sm/crypto'
import { ImportError, type ImportPlan } from '@sm/client'
import { describeError } from '../auth/errors'

/** 1 credential, 2 credentials */
export const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`

export interface PlanSummary {
  newCredentials: number
  newCards: number
  newListEntries: number
  /** Items already in the vault, whether matched by id, content or name. */
  alreadyThere: number
  /** Items that exist but differ from the backup. */
  different: number
  skipped: number
  total: number
}

export function summarizePlan(plan: ImportPlan): PlanSummary {
  const count = (type: string) => plan.creates.filter((c) => c.type === type).length
  const newCredentials = count('credential')
  const newCards = count('card')
  return {
    newCredentials,
    newCards,
    newListEntries: plan.creates.length - newCredentials - newCards,
    alreadyThere: plan.unchanged + plan.merged,
    different: plan.updates.length,
    skipped: plan.invalid.length,
    total: plan.creates.length,
  }
}

/** Plain-language messages for everything that can go wrong while exporting or importing. */
export function describeBackupError(err: unknown): string {
  if (err instanceof CryptoError) {
    switch (err.code) {
      case 'WEAK_PASSPHRASE':
        return 'Use at least 12 characters for the backup passphrase.'
      case 'DECRYPT_FAILED':
        return 'Wrong passphrase, or the file is damaged.'
      case 'INVALID_FORMAT':
        return 'This is not a Secret Manager backup file.'
      case 'INVALID_PARAMS':
        return 'This backup uses settings this app will not accept.'
    }
  }
  if (err instanceof ImportError) {
    return err.code === 'TOO_MANY'
      ? 'This backup holds too many items to import.'
      : 'Importing this file would pass the limit of 1,000 items. Delete some items first.'
  }
  if (err instanceof RangeError && err.message === 'FILE_TOO_LARGE') {
    return 'That file is too large to be a backup.'
  }
  return describeError(err)
}
