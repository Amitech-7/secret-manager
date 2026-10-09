import { type Session, type VaultItem } from '@sm/client'
import { LIMITS } from '@sm/shared'
import { useMemo, useState } from 'react'
import { Button, ButtonRow, Card, ErrorText, Notice } from '../auth/ui'
import { ConfirmDelete } from './ConfirmDelete'
import { Select, Tabs } from './controls'
import { CardCard, CredentialCard } from './ItemCards'
import { ItemForm } from './ItemForm'
import { ListsScreen } from './ListsScreen'
import { useVault } from './useVault'
import {
  accountsOfType,
  defaultMemberId,
  filterCards,
  filterCredentials,
  splitItems,
} from './vaultView'

type Tab = 'credential' | 'card'
type View =
  { kind: 'dashboard' } | { kind: 'lists' } | { kind: 'form'; type: Tab; editing?: VaultItem }

export function VaultScreen({
  session,
  onSessionChange,
}: {
  session: Session
  onSessionChange: (s: Session) => void
}) {
  const vault = useVault(session, onSessionChange)
  const split = useMemo(() => splitItems(vault.items), [vault.items])

  const [view, setView] = useState<View>({ kind: 'dashboard' })
  const [tab, setTab] = useState<Tab>('credential')
  const [memberPick, setMemberPick] = useState('')
  const [accountTypeId, setAccountTypeId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [bankId, setBankId] = useState('')
  const [deleting, setDeleting] = useState<VaultItem | null>(null)

  if (vault.status === 'loading') {
    return (
      <Card>
        <p role="status">Decrypting your vault…</p>
      </Card>
    )
  }
  if (vault.status === 'error') {
    return (
      <Card title="Could not load your vault">
        <ErrorText>{vault.error ?? 'Something went wrong.'}</ErrorText>
        <Button onClick={() => void vault.reload()}>Try again</Button>
      </Card>
    )
  }

  const memberId = split.members.some((m) => m.id === memberPick)
    ? memberPick
    : defaultMemberId(split.members)

  if (view.kind === 'lists') {
    return (
      <ListsScreen
        split={split}
        items={vault.items}
        vault={vault}
        onBack={() => setView({ kind: 'dashboard' })}
      />
    )
  }

  if (view.kind === 'form') {
    const editing = view.editing
    return (
      <Card>
        <ItemForm
          kind={view.type}
          split={split}
          editing={editing as VaultItem}
          defaults={{
            memberId,
            accountId: accountId || split.accounts[0]?.id || '',
            bankId: bankId || split.banks[0]?.id || '',
          }}
          onSave={async (values) => {
            if (editing) await vault.update(editing, values)
            else await vault.create(view.type, values as never)
            setView({ kind: 'dashboard' })
          }}
          onCancel={() => setView({ kind: 'dashboard' })}
          onReload={() => {
            setView({ kind: 'dashboard' })
            void vault.reload()
          }}
        />
      </Card>
    )
  }

  const credentials = filterCredentials(split, { memberId, accountTypeId, accountId })
  const cards = filterCards(split, { memberId, bankId })
  const used = vault.items.length + vault.unreadable.length
  const now = new Date()

  const confirm = (item: VaultItem, what: string, label: string) => (
    <li key={item.id}>
      <ConfirmDelete
        what={what}
        label={label}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          await vault.remove(item)
          setDeleting(null)
        }}
      />
    </li>
  )

  return (
    <div className="space-y-4">
      {vault.unreadable.length > 0 ? (
        <Notice>
          {vault.unreadable.length} item{vault.unreadable.length === 1 ? '' : 's'} could not be
          opened on this device. They are untouched on the server. Reload to try again.
        </Notice>
      ) : null}

      <Card>
        <Select
          label="Member"
          value={memberId}
          onChange={setMemberPick}
          options={split.members.map((m) => ({ value: m.id, label: m.payload.name }))}
        />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'credential', label: 'Credentials' },
            { value: 'card', label: 'Cards' },
          ]}
        />
        {tab === 'credential' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Account type"
              value={accountTypeId}
              onChange={(v) => {
                setAccountTypeId(v)
                setAccountId('')
              }}
              options={[
                { value: '', label: 'All types' },
                ...split.accountTypes.map((t) => ({ value: t.id, label: t.payload.name })),
              ]}
            />
            <Select
              label="Account"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: '', label: 'All accounts' },
                ...accountsOfType(split, accountTypeId).map((a) => ({
                  value: a.id,
                  label: a.payload.name,
                })),
              ]}
            />
          </div>
        ) : (
          <Select
            label="Bank"
            value={bankId}
            onChange={setBankId}
            options={[
              { value: '', label: 'All banks' },
              ...split.banks.map((b) => ({ value: b.id, label: b.payload.name })),
            ]}
          />
        )}
        <ButtonRow>
          <Button onClick={() => setView({ kind: 'form', type: tab })}>
            {tab === 'credential' ? 'Add credential' : 'Add card'}
          </Button>
          <Button variant="secondary" onClick={() => setView({ kind: 'lists' })}>
            Manage lists
          </Button>
        </ButtonRow>
      </Card>

      <ul className="space-y-3">
        {tab === 'credential'
          ? credentials.map((item) =>
              deleting?.id === item.id ? (
                confirm(item, 'credential', item.payload.username)
              ) : (
                <CredentialCard
                  key={item.id}
                  item={item}
                  split={split}
                  onEdit={() => setView({ kind: 'form', type: 'credential', editing: item })}
                  onDelete={() => setDeleting(item)}
                />
              ),
            )
          : cards.map((item) =>
              deleting?.id === item.id ? (
                confirm(item, 'card', item.payload.cardName)
              ) : (
                <CardCard
                  key={item.id}
                  item={item}
                  split={split}
                  now={now}
                  onEdit={() => setView({ kind: 'form', type: 'card', editing: item })}
                  onDelete={() => setDeleting(item)}
                />
              ),
            )}
      </ul>
      {(tab === 'credential' ? credentials : cards).length === 0 ? (
        <p className="text-center text-sm text-muted">
          Nothing here yet. Use the button above to add your first{' '}
          {tab === 'credential' ? 'credential' : 'card'}.
        </p>
      ) : null}
      <p className="text-center text-xs text-muted">
        {used} of {LIMITS.maxItemsPerUser} items used (including your lists).
      </p>
    </div>
  )
}
