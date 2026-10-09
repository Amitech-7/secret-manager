import { ApiRequestError, validatePayload, type VaultItem } from '@sm/client'
import { useState } from 'react'
import { describeError } from '../auth/errors'
import { Button, ButtonRow, ErrorText, Field, Notice } from '../auth/ui'
import { Select } from './controls'
import type { Split } from './vaultView'

type Kind = 'credential' | 'card'

function initialValues(
  kind: Kind,
  defaults: { memberId: string; accountId: string; bankId: string },
  editing?: VaultItem,
): Record<string, string> {
  if (editing) return { ...(editing.payload as Record<string, string>) }
  return kind === 'credential'
    ? {
        memberId: defaults.memberId,
        accountId: defaults.accountId,
        username: '',
        password: '',
        hint: '',
        remark: '',
        expiryDate: '',
      }
    : {
        memberId: defaults.memberId,
        bankId: defaults.bankId,
        cardName: '',
        nameOnCard: '',
        number: '',
        initialDate: '',
        expiryDate: '',
        cvv: '',
        remark: '',
      }
}

/** Add or edit a credential or card. Checks the values before anything is encrypted or sent. */
export function ItemForm(props: {
  kind: Kind
  split: Split
  defaults: { memberId: string; accountId: string; bankId: string }
  editing?: VaultItem
  onSave: (values: Record<string, string>) => Promise<void>
  onCancel: () => void
  onReload: () => void
}) {
  const { kind, split } = props
  const [values, setValues] = useState(() => initialValues(kind, props.defaults, props.editing))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<{ message: string; conflict: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }))
  const get = (key: string) => values[key] ?? ''
  const field = (key: string) => (errors[key] ? <ErrorText>{errors[key]}</ErrorText> : null)

  const memberOptions = split.members.map((m) => ({ value: m.id, label: m.payload.name }))
  const accountOptions = split.accounts.map((a) => ({
    value: a.id,
    label: `${a.payload.name} (${split.accountTypes.find((t) => t.id === a.payload.accountTypeId)?.payload.name ?? '?'})`,
  }))
  const bankOptions = split.banks.map((b) => ({ value: b.id, label: b.payload.name }))
  const missing =
    kind === 'credential' && accountOptions.length === 0
      ? 'Add an account in Manage lists first.'
      : kind === 'card' && bankOptions.length === 0
        ? 'Add a bank in Manage lists first.'
        : null

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault()
    const checked = validatePayload(kind, values)
    if (!checked.ok) {
      setErrors(checked.errors)
      setFailure(null)
      return
    }
    setErrors({})
    setBusy(true)
    setFailure(null)
    try {
      await props.onSave(values)
    } catch (err) {
      setFailure({
        message: describeError(err),
        conflict: err instanceof ApiRequestError && err.code === 'VERSION_CONFLICT',
      })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <h2 className="text-lg font-semibold">
        {props.editing ? 'Edit' : 'Add'} {kind === 'credential' ? 'credential' : 'card'}
      </h2>
      {missing ? <Notice>{missing}</Notice> : null}

      <Select
        label="Member"
        value={get('memberId')}
        onChange={set('memberId')}
        options={memberOptions}
      />
      {field('memberId')}

      {kind === 'credential' ? (
        <>
          <Select
            label="Account"
            value={get('accountId')}
            onChange={set('accountId')}
            options={accountOptions}
          />
          {field('accountId')}
          <Field
            label="Username"
            value={get('username')}
            onChange={set('username')}
            autoComplete="off"
          />
          {field('username')}
          <Field
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={get('password')}
            onChange={set('password')}
            autoComplete="off"
          />
          {field('password')}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            Show password while typing
          </label>
          <Field
            label="Hint (optional)"
            value={get('hint')}
            onChange={set('hint')}
            autoComplete="off"
          />
          {field('hint')}
          <Field
            label="Remark (optional)"
            value={get('remark')}
            onChange={set('remark')}
            autoComplete="off"
          />
          {field('remark')}
          <Field
            label="Password expiry (optional)"
            type="date"
            value={get('expiryDate')}
            onChange={set('expiryDate')}
          />
          {field('expiryDate')}
        </>
      ) : (
        <>
          <Select
            label="Bank"
            value={get('bankId')}
            onChange={set('bankId')}
            options={bankOptions}
          />
          {field('bankId')}
          <Field
            label="Card name"
            value={get('cardName')}
            onChange={set('cardName')}
            autoComplete="off"
            hint="For example: Travel card"
          />
          {field('cardName')}
          <Field
            label="Name on card"
            value={get('nameOnCard')}
            onChange={set('nameOnCard')}
            autoComplete="off"
          />
          {field('nameOnCard')}
          <Field
            label="Card number"
            value={get('number')}
            onChange={set('number')}
            autoComplete="off"
            mono
            hint="Spaces are fine."
          />
          {field('number')}
          <Field
            label="Valid from (optional)"
            type="month"
            value={get('initialDate')}
            onChange={set('initialDate')}
            hint="Month and year, like 2024-03"
          />
          {field('initialDate')}
          <Field
            label="Expiry"
            type="month"
            value={get('expiryDate')}
            onChange={set('expiryDate')}
            hint="Month and year, like 2030-09"
          />
          {field('expiryDate')}
          <Field label="CVV" value={get('cvv')} onChange={set('cvv')} autoComplete="off" mono />
          {field('cvv')}
          <Field
            label="Remark (optional)"
            value={get('remark')}
            onChange={set('remark')}
            autoComplete="off"
          />
          {field('remark')}
        </>
      )}

      {failure ? <ErrorText>{failure.message}</ErrorText> : null}
      <ButtonRow>
        <Button type="submit" disabled={busy || missing !== null}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={props.onCancel}>
          Cancel
        </Button>
        {failure?.conflict ? (
          <Button variant="secondary" onClick={props.onReload}>
            Reload vault
          </Button>
        ) : null}
      </ButtonRow>
    </form>
  )
}
