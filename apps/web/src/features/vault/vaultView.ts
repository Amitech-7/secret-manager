import { findReferences, type VaultItem } from '@sm/client'

/** Pure view logic for the vault screens: grouping, filtering, formatting. No React, no secrets stored. */

type Of<T extends VaultItem['type']> = Extract<VaultItem, { type: T }>

export interface Split {
  members: Of<'member'>[]
  banks: Of<'bank'>[]
  accountTypes: Of<'account_type'>[]
  accounts: Of<'account'>[]
  credentials: Of<'credential'>[]
  cards: Of<'card'>[]
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

export function splitItems(items: readonly VaultItem[]): Split {
  const out: Split = {
    members: [],
    banks: [],
    accountTypes: [],
    accounts: [],
    credentials: [],
    cards: [],
  }
  for (const item of items) {
    switch (item.type) {
      case 'member':
        out.members.push(item)
        break
      case 'bank':
        out.banks.push(item)
        break
      case 'account_type':
        out.accountTypes.push(item)
        break
      case 'account':
        out.accounts.push(item)
        break
      case 'credential':
        out.credentials.push(item)
        break
      case 'card':
        out.cards.push(item)
        break
    }
  }
  const byName = (a: { payload: { name: string } }, b: { payload: { name: string } }) =>
    byText(a.payload.name, b.payload.name)
  out.members.sort(byName)
  out.banks.sort(byName)
  out.accountTypes.sort(byName)
  out.accounts.sort(byName)
  return out
}

/** "Self" if there is one (the starter member), otherwise the first member alphabetically. */
export function defaultMemberId(members: readonly Of<'member'>[]): string {
  const self = members.find((m) => m.payload.name.trim().toLowerCase() === 'self')
  return (self ?? members[0])?.id ?? ''
}

export function accountsOfType(split: Split, accountTypeId: string): Of<'account'>[] {
  return accountTypeId
    ? split.accounts.filter((a) => a.payload.accountTypeId === accountTypeId)
    : split.accounts
}

export function accountInfo(split: Split, accountId: string): { name: string; typeName: string } {
  const account = split.accounts.find((a) => a.id === accountId)
  const type = account
    ? split.accountTypes.find((t) => t.id === account.payload.accountTypeId)
    : undefined
  return { name: account?.payload.name ?? 'Unknown account', typeName: type?.payload.name ?? '' }
}

export const bankName = (split: Split, bankId: string): string =>
  split.banks.find((b) => b.id === bankId)?.payload.name ?? 'Unknown bank'

export function filterCredentials(
  split: Split,
  filter: { memberId: string; accountTypeId: string; accountId: string },
): Of<'credential'>[] {
  const inType = new Set(accountsOfType(split, filter.accountTypeId).map((a) => a.id))
  return split.credentials
    .filter(
      (c) =>
        c.payload.memberId === filter.memberId &&
        (filter.accountId ? c.payload.accountId === filter.accountId : true) &&
        (filter.accountTypeId ? inType.has(c.payload.accountId) : true),
    )
    .sort(
      (a, b) =>
        byText(
          accountInfo(split, a.payload.accountId).name,
          accountInfo(split, b.payload.accountId).name,
        ) || byText(a.payload.username, b.payload.username),
    )
}

export function filterCards(
  split: Split,
  filter: { memberId: string; bankId: string },
): Of<'card'>[] {
  return split.cards
    .filter(
      (c) =>
        c.payload.memberId === filter.memberId &&
        (filter.bankId ? c.payload.bankId === filter.bankId : true),
    )
    .sort(
      (a, b) =>
        byText(bankName(split, a.payload.bankId), bankName(split, b.payload.bankId)) ||
        byText(a.payload.cardName, b.payload.cardName),
    )
}

// --- card formatting --------------------------------------------------------------------------

const groups = (s: string) => s.match(/.{1,4}/g)?.join(' ') ?? ''

/** 4111111111111111 -> "4111 1111 1111 1111" */
export const formatCardNumber = (digits: string): string => groups(digits)

/** 4111111111110123 -> "xxxx xxxx xxxx 0123". Only the last four digits are ever shown. */
export function maskCardNumber(digits: string): string {
  const last = digits.slice(-4)
  const hidden = groups('x'.repeat(Math.max(0, digits.length - 4)))
  return [hidden, last].filter(Boolean).join(' ')
}

/** "2030-09" -> "09/30" */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  return m ? `${m[2]}/${m[1]!.slice(2)}` : month
}

/** A card is valid through the end of its expiry month. */
export function isCardExpired(month: string, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return false
  const endExclusive = Date.UTC(Number(m[1]), Number(m[2]), 1)
  return now.getTime() >= endExclusive
}

// --- names and deletion -----------------------------------------------------------------------

/** Case-insensitive duplicate check, ignoring surrounding spaces. */
export function nameTaken(
  existing: ReadonlyArray<{ id: string; name: string }>,
  name: string,
  exceptId?: string,
): boolean {
  const wanted = name.trim().toLowerCase()
  return existing.some((e) => e.id !== exceptId && e.name.trim().toLowerCase() === wanted)
}

/** What the person must type to confirm a delete. Forgiving about case and spaces. */
export function confirmMatches(label: string, typed: string): boolean {
  const want = label.trim().toLowerCase()
  return want.length > 0 && typed.trim().toLowerCase() === want
}

/**
 * Why `target` must not be deleted right now, or null if it can go. The server cannot see links
 * between items, so this is the only guard against leaving credentials or cards pointing at
 * something that no longer exists.
 */
export function deleteBlockReason(
  items: readonly VaultItem[],
  target: { id: string; type: VaultItem['type'] },
): string | null {
  const used = findReferences(items, target).length
  if (used > 0) {
    return `Still used by ${used} item${used === 1 ? '' : 's'}. Move or delete ${used === 1 ? 'it' : 'them'} first.`
  }
  if (target.type === 'member' && items.filter((i) => i.type === 'member').length <= 1) {
    return 'Keep at least one member.'
  }
  return null
}
