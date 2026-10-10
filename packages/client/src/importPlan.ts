import { ITEM_TYPES, LIMITS, type ItemType } from '@sm/shared'
import { validatePayload, type VaultItem } from './vault'

/**
 * Works out what importing a backup would do, without touching anything. Rules:
 *  - Items are matched to what is already in the vault by id first, then by content
 *    (credential: member + account + username; card: member + bank + number), so importing the
 *    same file twice changes nothing and a file from another account merges cleanly.
 *  - Members, banks, account types and accounts are matched by name when their ids differ, and
 *    credentials and cards are re-pointed at the matching entry.
 *  - Anything new gets a fresh id, so a file can never collide with another account's ids.
 */

export interface RawImportItem {
  id: string
  type: string
  payload: unknown
}
type Payload = Record<string, unknown>

export interface PlannedCreate {
  type: ItemType
  id: string
  payload: Payload
}
export interface PlannedUpdate {
  existing: VaultItem
  payload: Payload
}
export interface InvalidImportItem {
  id: string
  type: string
  reason: string
}

export interface ImportPlan {
  /** Reference items (members, banks, ...) come first, so a half-finished import is still consistent. */
  creates: PlannedCreate[]
  /** Items that exist but differ from the file. Only applied if the person chooses to overwrite. */
  updates: PlannedUpdate[]
  unchanged: number
  /** Reference items matched to an existing one by name rather than id. */
  merged: number
  invalid: InvalidImportItem[]
  /** Rows already used on the server, including ones this device could not read. */
  occupied: number
  overQuota: boolean
}

export const MAX_IMPORT_ITEMS = 5000

export class ImportError extends Error {
  readonly code: 'TOO_MANY' | 'OVER_QUOTA'
  constructor(code: 'TOO_MANY' | 'OVER_QUOTA', message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const norm = (s: unknown) => String(s).trim().toLowerCase()
const isItemType = (t: string): t is ItemType => (ITEM_TYPES as readonly string[]).includes(t)

const stable = (p: unknown): string =>
  JSON.stringify(p, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
export const samePayload = (a: unknown, b: unknown) => stable(a) === stable(b)

interface PoolEntry {
  id: string
  name: string
  parent: string
}

export function planImport(
  existing: readonly VaultItem[],
  occupied: number,
  fileItems: readonly RawImportItem[],
  newId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  if (fileItems.length > MAX_IMPORT_ITEMS) {
    throw new ImportError('TOO_MANY', `A backup can hold at most ${MAX_IMPORT_ITEMS} items.`)
  }
  const plan: ImportPlan = {
    creates: [],
    updates: [],
    unchanged: 0,
    merged: 0,
    invalid: [],
    occupied,
    overQuota: false,
  }
  const reject = (raw: RawImportItem, reason: string) =>
    plan.invalid.push({
      id: String(raw.id).slice(0, 40),
      type: String(raw.type).slice(0, 20),
      reason,
    })

  // 1. Validate everything first. Nothing from the file is trusted.
  const seen = new Set<string>()
  const valid: Array<{ id: string; type: ItemType; payload: Payload }> = []
  for (const raw of fileItems) {
    if (typeof raw.id !== 'string' || !UUID.test(raw.id)) {
      reject(raw, 'Has no valid id.')
    } else if (seen.has(raw.id)) {
      reject(raw, 'Appears twice in the file.')
    } else if (typeof raw.type !== 'string' || !isItemType(raw.type)) {
      reject(raw, 'Unknown kind of item.')
    } else {
      seen.add(raw.id)
      const checked = validatePayload(raw.type, raw.payload)
      if (checked.ok)
        valid.push({ id: raw.id, type: raw.type, payload: checked.payload as Payload })
      else reject(raw, Object.values(checked.errors)[0] ?? 'Content is not valid.')
    }
  }

  const byId = new Map(existing.map((i) => [i.id, i]))
  const idMap = new Map<string, string>() // id in the file -> id in this vault
  const pools: Record<string, PoolEntry[]> = {
    member: [],
    bank: [],
    account_type: [],
    account: [],
  }
  for (const item of existing) {
    const pool = pools[item.type]
    if (pool) {
      const p = item.payload as { name: string; accountTypeId?: string }
      pool.push({ id: item.id, name: p.name, parent: p.accountTypeId ?? '' })
    }
  }

  // A reference in the file points at an entry from the file, or failing that at an entry of this
  // vault with the same id (restoring a partial file into the account it came from).
  const resolve = (fileId: unknown, type: ItemType): string | null => {
    const mapped = idMap.get(String(fileId))
    if (mapped) return mapped
    const local = byId.get(String(fileId))
    return local && local.type === type ? local.id : null
  }

  // 2. Reference lists, in dependency order.
  for (const type of ['member', 'bank', 'account_type', 'account'] as const) {
    const pool = pools[type]!
    for (const item of valid.filter((v) => v.type === type)) {
      let payload = item.payload
      let parent = ''
      if (type === 'account') {
        const typeId = resolve(payload.accountTypeId, 'account_type')
        if (!typeId) {
          reject(item, 'Refers to an account type that is not in the file.')
          continue
        }
        payload = { ...payload, accountTypeId: typeId }
        parent = typeId
      }
      const name = String(payload.name)
      const taken = (exceptId: string) =>
        pool.some((e) => e.id !== exceptId && e.parent === parent && norm(e.name) === norm(name))

      const sameId = byId.get(item.id)
      if (sameId && sameId.type === type && !taken(sameId.id)) {
        idMap.set(item.id, sameId.id)
        if (samePayload(sameId.payload, payload)) plan.unchanged++
        else plan.updates.push({ existing: sameId, payload })
        continue
      }
      const sameName = pool.find((e) => e.parent === parent && norm(e.name) === norm(name))
      if (sameName) {
        idMap.set(item.id, sameName.id)
        plan.merged++
        continue
      }
      const id = newId()
      plan.creates.push({ type, id, payload })
      pool.push({ id, name, parent })
      idMap.set(item.id, id)
    }
  }

  // 3. Credentials and cards, pointed at the matching reference entries.
  const keyOf = (type: ItemType, p: Payload): string =>
    type === 'credential'
      ? `c|${String(p.memberId)}|${String(p.accountId)}|${norm(p.username)}`
      : `k|${String(p.memberId)}|${String(p.bankId)}|${String(p.number)}`

  const existingByKey = new Map<string, VaultItem>()
  for (const item of existing) {
    if (item.type === 'credential' || item.type === 'card') {
      existingByKey.set(keyOf(item.type, item.payload as Payload), item)
    }
  }
  const plannedByKey = new Map<string, Payload>()
  const touched = new Set<string>()

  for (const item of valid.filter((v) => v.type === 'credential' || v.type === 'card')) {
    const memberId = resolve(item.payload.memberId, 'member')
    const otherId =
      item.type === 'credential'
        ? resolve(item.payload.accountId, 'account')
        : resolve(item.payload.bankId, 'bank')
    if (!memberId || !otherId) {
      reject(
        item,
        !memberId
          ? 'Refers to a member that is not in the file.'
          : item.type === 'credential'
            ? 'Refers to an account that is not in the file.'
            : 'Refers to a bank that is not in the file.',
      )
      continue
    }
    const payload: Payload =
      item.type === 'credential'
        ? { ...item.payload, memberId, accountId: otherId }
        : { ...item.payload, memberId, bankId: otherId }
    const key = keyOf(item.type, payload)

    const sameId = byId.get(item.id)
    const found = sameId && sameId.type === item.type ? sameId : existingByKey.get(key)
    if (found) {
      if (touched.has(found.id)) {
        reject(item, 'Duplicates another item in the file.')
      } else {
        touched.add(found.id)
        if (samePayload(found.payload, payload)) plan.unchanged++
        else plan.updates.push({ existing: found, payload })
      }
      continue
    }
    const planned = plannedByKey.get(key)
    if (planned) {
      if (samePayload(planned, payload)) plan.unchanged++
      else reject(item, 'Duplicates another item in the file.')
      continue
    }
    plannedByKey.set(key, payload)
    plan.creates.push({ type: item.type, id: newId(), payload })
  }

  plan.overQuota = occupied + plan.creates.length > LIMITS.maxItemsPerUser
  return plan
}
