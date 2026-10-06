import type { ItemType } from '@sm/shared'

export interface SeedItem {
  id: string
  type: ItemType
  payload: Record<string, string>
}

/** What a brand-new vault contains. Built in the browser and encrypted before upload. */
export function buildSeed(newId: () => string = () => crypto.randomUUID()): SeedItem[] {
  const items: SeedItem[] = []
  const add = (type: ItemType, payload: Record<string, string>) => {
    const id = newId()
    items.push({ id, type, payload })
    return id
  }

  add('member', { name: 'Self' })
  const accountTypes = Object.fromEntries(
    ['Web', 'Bank', 'Academic', 'Social Media', 'Misc'].map((name) => [
      name,
      add('account_type', { name }),
    ]),
  ) as Record<string, string>
  const accounts: Array<[string, string]> = [
    ['Google', 'Web'],
    ['Microsoft', 'Web'],
    ['Zoho', 'Web'],
    ['Meta', 'Social Media'],
    ['Misc', 'Misc'],
  ]
  for (const [name, type] of accounts) add('account', { accountTypeId: accountTypes[type]!, name })
  add('bank', { name: 'Misc' })
  return items
}
