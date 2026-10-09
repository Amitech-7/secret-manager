import {
  createItem,
  deleteItem,
  loadVault,
  updateItem,
  type PayloadInput,
  type Session,
  type UnreadableItem,
  type VaultItem,
} from '@sm/client'
import type { ItemType } from '@sm/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/client'
import { describeError } from '../auth/errors'

type Status = 'loading' | 'ready' | 'error'

/**
 * Holds the decrypted vault in memory for as long as the vault screen is open. Every write goes
 * to the server first and only then into local state, so the screen never shows a save that did
 * not happen. Token refreshes that happen along the way are passed up to the app.
 */
export function useVault(session: Session, onSessionChange: (s: Session) => void) {
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<VaultItem[]>([])
  const [unreadable, setUnreadable] = useState<UnreadableItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const sessionRef = useRef(session)
  sessionRef.current = session
  const notify = useRef(onSessionChange)
  notify.current = onSessionChange

  const adopt = (next: Session) => {
    if (next !== sessionRef.current) {
      sessionRef.current = next
      notify.current(next)
    }
  }

  const reload = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const loaded = await loadVault(sessionRef.current, { api })
      adopt(loaded.session)
      setItems(loaded.items)
      setUnreadable(loaded.unreadable)
      setStatus('ready')
    } catch (err) {
      setError(describeError(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function create<T extends ItemType>(type: T, input: PayloadInput<T>): Promise<VaultItem> {
    const { item, session: next } = await createItem(sessionRef.current, { api }, type, input)
    adopt(next)
    setItems((prev) => [...prev, item])
    return item
  }

  async function update(existing: VaultItem, input: Record<string, string>): Promise<VaultItem> {
    // The payload schema for existing.type re-checks `input` at runtime, so the casts are safe.
    const { item, session: next } = await updateItem(
      sessionRef.current,
      { api },
      existing as never,
      input as never,
    )
    adopt(next)
    setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
    return item
  }

  async function remove(item: VaultItem): Promise<void> {
    const { session: next } = await deleteItem(sessionRef.current, { api }, item.id)
    adopt(next)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  return { status, items, unreadable, error, reload, create, update, remove }
}

export type VaultApi = ReturnType<typeof useVault>
