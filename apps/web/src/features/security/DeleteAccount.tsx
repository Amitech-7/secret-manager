import { deleteAccount, withFreshSession, type Session } from '@sm/client'
import { useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from '../auth/errors'
import { Button, Card, ErrorText, Field } from '../auth/ui'

const WORD = 'DELETE'

export function DeleteAccount({ session, onDeleted }: { session: Session; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await withFreshSession(session, { api }, (accessToken) =>
        deleteAccount({ api, kdf: workerKdf, accessToken, password }),
      )
      onDeleted()
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }

  return (
    <Card title="Delete account">
      <p className="text-sm text-muted">
        This permanently deletes your account and everything stored in it, on every device. It
        cannot be undone, and nobody can recover it.
      </p>
      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field
            label="Master password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={busy}
          />
          <Field
            label={`Type ${WORD} to confirm`}
            value={typed}
            onChange={setTyped}
            disabled={busy}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button type="submit" variant="danger" disabled={busy || !password || typed !== WORD}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </Button>
        </form>
      )}
    </Card>
  )
}
