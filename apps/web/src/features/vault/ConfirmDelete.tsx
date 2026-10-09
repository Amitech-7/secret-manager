import { useState } from 'react'
import { Button, ButtonRow, ErrorText, Field } from '../auth/ui'
import { describeError } from '../auth/errors'
import { confirmMatches } from './vaultView'

/** Deleting is permanent and instant, so the person has to type what they are deleting. */
export function ConfirmDelete(props: {
  what: string
  label: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await props.onConfirm()
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }

  return (
    <div role="alertdialog" className="space-y-3 rounded-xl border-2 border-danger bg-surface p-4">
      <p className="font-semibold text-danger">Delete this {props.what} permanently?</p>
      <p className="text-sm">
        This cannot be undone. Type <strong className="break-all">{props.label}</strong> to confirm.
      </p>
      <Field label="Type to confirm" value={typed} onChange={setTyped} autoComplete="off" />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ButtonRow>
        <Button
          variant="danger"
          disabled={busy || !confirmMatches(props.label, typed)}
          onClick={() => void go()}
        >
          {busy ? 'Deleting…' : 'Delete forever'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </ButtonRow>
    </div>
  )
}
