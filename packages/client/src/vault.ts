import { CryptoError, decryptItem, encryptItem } from '@sm/crypto'
import type { ItemType } from '@sm/shared'
import { z } from 'zod'
import type { ItemRecord } from './api'
import { withFreshSession, type AuthOptions, type Session } from './auth'

// --- payload shapes (what is inside each encrypted item) --------------------------------------
// Limits follow the original spec. Optional text is stored as '' so forms never deal with
// undefined. Nothing here is ever sent to the server in the clear.

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).default('')

const validDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
}
/** A real calendar day, YYYY-MM-DD, or '' when not set. */
const optionalDay = z
  .union([
    z.literal(''),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(validDate),
  ])
  .default('')
/** Cards print month and year only, so those dates are stored as YYYY-MM. */
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const optionalMonth = z.union([z.literal(''), month]).default('')

export const payloadSchemas = {
  member: z.object({ name: text(20) }),
  bank: z.object({ name: text(20) }),
  account_type: z.object({ name: text(20) }),
  account: z.object({ accountTypeId: z.uuid(), name: text(20) }),
  credential: z.object({
    memberId: z.uuid(),
    accountId: z.uuid(),
    username: text(32),
    // Never trimmed: leading or trailing spaces can be part of a real password.
    password: z.string().min(1).max(100),
    hint: optionalText(100),
    remark: optionalText(100),
    expiryDate: optionalDay,
  }),
  card: z.object({
    memberId: z.uuid(),
    bankId: z.uuid(),
    cardName: text(32),
    nameOnCard: text(32),
    // Spaces and hyphens are typing aids; the stored number is digits only.
    number: z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^\d{8,19}$/)),
    initialDate: optionalMonth,
    expiryDate: month,
    cvv: z.string().regex(/^\d{3,5}$/),
    remark: optionalText(100),
  }),
} as const satisfies Record<ItemType, z.ZodType>

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  memberId: 'Member',
  accountId: 'Account',
  accountTypeId: 'Account type',
  bankId: 'Bank',
  username: 'Username',
  password: 'Password',
  hint: 'Hint',
  remark: 'Remark',
  expiryDate: 'Expiry date',
  initialDate: 'Start date',
  cardName: 'Card name',
  nameOnCard: 'Name on card',
  number: 'Card number',
  cvv: 'CVV',
}

export type Validation<T extends ItemType> =
  { ok: true; payload: PayloadOf<T> } | { ok: false; errors: Record<string, string> }

/** Checks a form's values and returns one plain-language message per bad field. */
export function validatePayload<T extends ItemType>(type: T, input: unknown): Validation<T> {
  const parsed = payloadSchemas[type].safeParse(input)
  if (parsed.success) return { ok: true, payload: parsed.data as PayloadOf<T> }
  const errors: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'form')
    if (errors[field]) continue
    const label = FIELD_LABELS[field] ?? field
    const monthField = type === 'card' && (field === 'expiryDate' || field === 'initialDate')
    const choose = field.endsWith('Id')
    const tooBig = issue.code === 'too_big' && 'maximum' in issue ? issue.maximum : null
    const empty =
      issue.code === 'too_small' || (issue.code === 'invalid_type' && issue.input === undefined)
    errors[field] =
      type === 'card' && field === 'number'
        ? 'Card number must be 8 to 19 digits.'
        : type === 'card' && field === 'cvv'
          ? 'CVV must be 3 to 5 digits.'
          : monthField
            ? 'Use month and year, like 2030-09.'
            : choose
              ? `Choose a ${label.toLowerCase()}.`
              : empty
                ? `${label} is required.`
                : tooBig !== null
                  ? `${label} is too long (at most ${String(tooBig)} characters).`
                  : `${label} is not valid.`
  }
  return { ok: false, errors }
}

export type PayloadOf<T extends ItemType> = z.output<(typeof payloadSchemas)[T]>
export type PayloadInput<T extends ItemType> = z.input<(typeof payloadSchemas)[T]>

export type VaultItem = {
  [T in ItemType]: {
    id: string
    type: T
    version: number
    createdAt: Date
    updatedAt: Date
    payload: PayloadOf<T>
  }
}[ItemType]

/** An item the server holds but this browser could not open. It is reported, never hidden. */
export interface UnreadableItem {
  id: string
  type: string
  version: number
  /** DECRYPT: wrong key, tampering or a moved blob. FORMAT: opened, but the content is invalid. */
  reason: 'DECRYPT' | 'FORMAT'
}

type DataOptions = Pick<AuthOptions, 'api' | 'now'>

async function open(
  session: Session,
  record: ItemRecord,
): Promise<{ item: VaultItem } | { bad: UnreadableItem }> {
  const bad = (reason: UnreadableItem['reason']) => ({
    bad: { id: record.id, type: record.type, version: record.version, reason },
  })
  const schema = (payloadSchemas as Record<string, z.ZodType | undefined>)[record.type]
  if (!schema) return bad('FORMAT')
  let raw: unknown
  try {
    raw = await decryptItem(
      session.vaultKey,
      { itemId: record.id, type: record.type },
      record.ciphertext,
    )
  } catch (err) {
    return bad(err instanceof CryptoError && err.code === 'INVALID_FORMAT' ? 'FORMAT' : 'DECRYPT')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return bad('FORMAT')
  return {
    item: {
      id: record.id,
      type: record.type,
      version: record.version,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      payload: parsed.data,
    } as VaultItem,
  }
}

/** Pages through every item and decrypts it. One corrupt item never blocks the rest. */
export async function loadVault(
  session: Session,
  options: DataOptions & { pageSize?: number },
): Promise<{
  items: VaultItem[]
  unreadable: UnreadableItem[]
  session: Session
}> {
  const items: VaultItem[] = []
  const unreadable: UnreadableItem[] = []
  let current = session
  let after: string | undefined
  // The server caps an account at LIMITS.maxItemsPerUser, so this bound is generous but finite.
  for (let page = 0; page < 100; page++) {
    const fetched = await withFreshSession(current, options, (token) =>
      options.api.listItems(token, {
        ...(after ? { after } : {}),
        ...(options.pageSize ? { limit: options.pageSize } : {}),
      }),
    )
    current = fetched.session
    const opened = await Promise.all(fetched.result.items.map((r) => open(current, r)))
    for (const o of opened) {
      if ('item' in o) items.push(o.item)
      else unreadable.push(o.bad)
    }
    const next = fetched.result.nextCursor
    if (!next) return { items, unreadable, session: current }
    if (next === after) break // a cursor that does not advance would loop forever
    after = next
  }
  throw new Error('The server returned too many pages')
}

async function seal(session: Session, id: string, type: ItemType, input: unknown) {
  const payload = payloadSchemas[type].parse(input)
  const ciphertext = await encryptItem(session.vaultKey, { itemId: id, type }, payload)
  return { payload, ciphertext }
}

export async function createItem<T extends ItemType>(
  session: Session,
  options: DataOptions,
  type: T,
  input: PayloadInput<T>,
): Promise<{ item: VaultItem; session: Session }> {
  const id = crypto.randomUUID()
  const { payload, ciphertext } = await seal(session, id, type, input)
  const { result, session: next } = await withFreshSession(session, options, (token) =>
    options.api.createItem(token, { id, type, ciphertext }),
  )
  const at = new Date(result.updatedAt)
  const item = {
    id,
    type,
    version: result.version,
    createdAt: at,
    updatedAt: at,
    payload,
  }
  return { item: item as VaultItem, session: next }
}

/** Throws ApiRequestError VERSION_CONFLICT if another device changed the item since it was loaded. */
export async function updateItem<T extends ItemType>(
  session: Session,
  options: DataOptions,
  existing: Extract<VaultItem, { type: T }>,
  input: PayloadInput<T>,
): Promise<{ item: VaultItem; session: Session }> {
  const { payload, ciphertext } = await seal(session, existing.id, existing.type, input)
  const { result, session: next } = await withFreshSession(session, options, (token) =>
    options.api.updateItem(token, existing.id, {
      baseVersion: existing.version,
      ciphertext,
    }),
  )
  const item = {
    ...existing,
    version: result.version,
    updatedAt: new Date(result.updatedAt),
    payload,
  }
  return { item: item as VaultItem, session: next }
}

export async function deleteItem(
  session: Session,
  options: DataOptions,
  id: string,
): Promise<{ session: Session }> {
  const { session: next } = await withFreshSession(session, options, (token) =>
    options.api.deleteItem(token, id),
  )
  return { session: next }
}

/**
 * Items that point at `target`. The server cannot see these links (they are inside ciphertext),
 * so the UI must call this and refuse to delete a member, bank, account or account type while
 * anything still uses it.
 */
export function findReferences(
  items: readonly VaultItem[],
  target: { id: string; type: ItemType },
): VaultItem[] {
  return items.filter((item) => {
    switch (target.type) {
      case 'member':
        return (
          (item.type === 'credential' || item.type === 'card') &&
          item.payload.memberId === target.id
        )
      case 'bank':
        return item.type === 'card' && item.payload.bankId === target.id
      case 'account':
        return item.type === 'credential' && item.payload.accountId === target.id
      case 'account_type':
        return item.type === 'account' && item.payload.accountTypeId === target.id
      default:
        return false
    }
  })
}

/** A short, safe label for places that must not show secrets (lists, delete confirmations). */
export function itemLabel(item: VaultItem): string {
  switch (item.type) {
    case 'credential':
      return item.payload.username
    case 'card':
      return item.payload.cardName
    default:
      return item.payload.name
  }
}
