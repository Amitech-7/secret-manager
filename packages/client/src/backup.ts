import { createExport, encryptItem, readExport, type KdfParams } from '@sm/crypto'
import { withFreshSession, directKdf, type AuthOptions, type KdfRunner, type Session } from './auth'
import { ImportError, planImport, type ImportPlan } from './importPlan'
import { loadVault, type UnreadableItem } from './vault'

type BackupOptions = Pick<AuthOptions, 'api' | 'now'> & { kdf?: KdfRunner }

/** Items per request when importing; the server accepts at most this many at once. */
export const IMPORT_CHUNK = 50

/** secret-manager-2026-10-10.smvault */
export const exportFileName = (date: Date): string =>
  `secret-manager-${date.toISOString().slice(0, 10)}.smvault`

/**
 * Builds an encrypted backup of everything this device can read. Items it cannot open are
 * counted and left out, never silently dropped.
 */
export async function exportVault(
  session: Session,
  options: BackupOptions,
  passphrase: string,
  kdfParams?: KdfParams,
): Promise<{
  file: string
  fileName: string
  itemCount: number
  unreadable: UnreadableItem[]
  session: Session
}> {
  const loaded = await loadVault(session, options)
  const file = await createExport(
    passphrase,
    loaded.items.map((i) => ({ id: i.id, type: i.type, payload: i.payload })),
    kdfParams,
    options.kdf ?? directKdf,
  )
  const now = options.now ? new Date(options.now()) : new Date()
  return {
    file,
    fileName: exportFileName(now),
    itemCount: loaded.items.length,
    unreadable: loaded.unreadable,
    session: loaded.session,
  }
}

/** Decrypts a backup and works out what importing it would do. Changes nothing. */
export async function previewImport(
  session: Session,
  options: BackupOptions,
  passphrase: string,
  fileText: string,
): Promise<{ plan: ImportPlan; session: Session }> {
  const [loaded, fileItems] = await Promise.all([
    loadVault(session, options),
    readExport(passphrase, fileText, options.kdf ?? directKdf),
  ])
  const occupied = loaded.items.length + loaded.unreadable.length
  return { plan: planImport(loaded.items, occupied, fileItems), session: loaded.session }
}

/**
 * Writes a plan to the vault in chunks. Not atomic as a whole, but safe to repeat: running the
 * same import again only adds what is still missing.
 */
export async function applyImport(
  session: Session,
  options: BackupOptions,
  plan: ImportPlan,
  settings: { overwrite: boolean; onProgress?: (done: number, total: number) => void },
): Promise<{ created: number; updated: number; session: Session }> {
  if (plan.overQuota) throw new ImportError('OVER_QUOTA', 'This import would pass the item limit.')
  const updates = settings.overwrite ? plan.updates : []
  const total = plan.creates.length + updates.length
  let current = session
  let done = 0
  const key = () => current.vaultKey

  for (let i = 0; i < plan.creates.length; i += IMPORT_CHUNK) {
    const chunk = plan.creates.slice(i, i + IMPORT_CHUNK)
    const items = await Promise.all(
      chunk.map(async (c) => ({
        id: c.id,
        type: c.type,
        ciphertext: await encryptItem(key(), { itemId: c.id, type: c.type }, c.payload),
      })),
    )
    const sent = await withFreshSession(current, options, (token) =>
      options.api.createItems(token, items),
    )
    current = sent.session
    done += chunk.length
    settings.onProgress?.(done, total)
  }

  for (let i = 0; i < updates.length; i += IMPORT_CHUNK) {
    const chunk = updates.slice(i, i + IMPORT_CHUNK)
    const items = await Promise.all(
      chunk.map(async (u) => ({
        id: u.existing.id,
        baseVersion: u.existing.version,
        ciphertext: await encryptItem(
          key(),
          { itemId: u.existing.id, type: u.existing.type },
          u.payload,
        ),
      })),
    )
    const sent = await withFreshSession(current, options, (token) =>
      options.api.updateItems(token, items),
    )
    current = sent.session
    done += chunk.length
    settings.onProgress?.(done, total)
  }

  return { created: plan.creates.length, updated: updates.length, session: current }
}
