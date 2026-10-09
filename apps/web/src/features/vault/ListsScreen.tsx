import { validatePayload, type VaultItem } from '@sm/client'
import { useState } from 'react'
import { describeError } from '../auth/errors'
import { Button, ButtonRow, Card, ErrorText, Field } from '../auth/ui'
import { ConfirmDelete } from './ConfirmDelete'
import { Select, SmallButton } from './controls'
import type { VaultApi } from './useVault'
import { deleteBlockReason, nameTaken, type Split } from './vaultView'

type ListType = 'member' | 'bank' | 'account_type' | 'account'
type ListItem = Extract<VaultItem, { type: ListType }>

const SECTIONS: ReadonlyArray<{ type: ListType; title: string; noun: string }> = [
  { type: 'member', title: 'Members', noun: 'member' },
  { type: 'bank', title: 'Banks', noun: 'bank' },
  { type: 'account_type', title: 'Account types', noun: 'account type' },
  { type: 'account', title: 'Accounts', noun: 'account' },
]

const itemsOf = (split: Split, type: ListType): ListItem[] =>
  ({
    member: split.members,
    bank: split.banks,
    account_type: split.accountTypes,
    account: split.accounts,
  })[type]

/** Manage the lists that credentials and cards point at: members, banks, account types, accounts. */
export function ListsScreen(props: {
  split: Split
  items: readonly VaultItem[]
  vault: VaultApi
  onBack: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Manage lists</h2>
        <Button variant="secondary" onClick={props.onBack}>
          Back
        </Button>
      </div>
      {SECTIONS.map((s) => (
        <ListSection key={s.type} {...s} {...props} />
      ))}
    </div>
  )
}

function ListSection(props: {
  type: ListType
  title: string
  noun: string
  split: Split
  items: readonly VaultItem[]
  vault: VaultApi
}) {
  const { type, split, vault } = props
  const list = itemsOf(split, type)
  const [newName, setNewName] = useState('')
  const [newTypeId, setNewTypeId] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<ListItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const typeName = (item: ListItem) =>
    item.type === 'account'
      ? (split.accountTypes.find((t) => t.id === item.payload.accountTypeId)?.payload.name ?? '?')
      : ''
  const chosenType = newTypeId || split.accountTypes[0]?.id || ''

  // Account names only have to be unique within their type ("Misc" exists under Misc already).
  const peers = (accountTypeId?: string) =>
    list
      .filter((i) => i.type !== 'account' || i.payload.accountTypeId === accountTypeId)
      .map((i) => ({ id: i.id, name: i.payload.name }))

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const input =
      type === 'account' ? { accountTypeId: chosenType, name: newName } : { name: newName }
    const checked = validatePayload(type, input)
    if (!checked.ok) return setError(Object.values(checked.errors)[0] ?? 'Check the name.')
    const accountTypeId = type === 'account' ? chosenType : undefined
    if (nameTaken(peers(accountTypeId), newName)) return setError('That name already exists.')
    await run(async () => {
      await vault.create(type, input as never)
      setNewName('')
    })
  }

  async function rename(item: ListItem) {
    if (!editing) return
    const input = { ...(item.payload as Record<string, string>), name: editing.name }
    const checked = validatePayload(type, input)
    if (!checked.ok) return setError(Object.values(checked.errors)[0] ?? 'Check the name.')
    const accountTypeId = item.type === 'account' ? item.payload.accountTypeId : undefined
    if (nameTaken(peers(accountTypeId), editing.name, item.id)) {
      return setError('That name already exists.')
    }
    await run(async () => {
      await vault.update(item, input)
      setEditing(null)
    })
  }

  return (
    <Card title={props.title}>
      <ul className="space-y-2">
        {list.map((item) => {
          const reason = deleting?.id === item.id ? deleteBlockReason(props.items, item) : null
          return (
            <li key={item.id} className="space-y-2">
              {editing?.id === item.id ? (
                <div className="space-y-2">
                  <Field
                    label={`Rename ${props.noun}`}
                    value={editing.name}
                    onChange={(name) => setEditing({ id: item.id, name })}
                  />
                  <ButtonRow>
                    <Button disabled={busy} onClick={() => void rename(item)}>
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </ButtonRow>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 break-all">
                    {item.payload.name}
                    {typeName(item) ? (
                      <span className="text-muted"> · {typeName(item)}</span>
                    ) : null}
                  </p>
                  <div className="flex gap-2">
                    <SmallButton
                      onClick={() => setEditing({ id: item.id, name: item.payload.name })}
                    >
                      Rename
                    </SmallButton>
                    <SmallButton danger onClick={() => setDeleting(item)}>
                      Delete
                    </SmallButton>
                  </div>
                </div>
              )}
              {deleting?.id === item.id ? (
                reason ? (
                  <div className="space-y-2 rounded-lg border border-danger p-3">
                    <p className="text-sm text-danger">{reason}</p>
                    <SmallButton onClick={() => setDeleting(null)}>OK</SmallButton>
                  </div>
                ) : (
                  <ConfirmDelete
                    what={props.noun}
                    label={item.payload.name}
                    onCancel={() => setDeleting(null)}
                    onConfirm={async () => {
                      await vault.remove(item)
                      setDeleting(null)
                    }}
                  />
                )
              ) : null}
            </li>
          )
        })}
        {list.length === 0 ? <li className="text-sm text-muted">Nothing here yet.</li> : null}
      </ul>

      <div className="space-y-2 border-t border-border pt-4">
        {type === 'account' ? (
          <Select
            label="Account type"
            value={chosenType}
            onChange={setNewTypeId}
            options={split.accountTypes.map((t) => ({ value: t.id, label: t.payload.name }))}
          />
        ) : null}
        <Field
          label={`New ${props.noun}`}
          value={newName}
          onChange={setNewName}
          autoComplete="off"
        />
        <Button disabled={busy || !newName.trim()} onClick={() => void add()}>
          Add {props.noun}
        </Button>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  )
}
