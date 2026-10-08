import { changePassword, withFreshSession, type Session } from '@sm/client'
import { useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from '../auth/errors'
import { NewPasswordFields } from '../auth/NewPasswordFields'
import { Button, Card, ErrorText, Field, Notice } from '../auth/ui'

export function ChangePassword({
  session,
  onSessionChange,
}: {
  session: Session
  onSessionChange: (s: Session) => void
}) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const { session: next } = await withFreshSession(session, { api }, (accessToken) =>
        changePassword({
          api,
          kdf: workerKdf,
          accessToken,
          currentPassword: current,
          newPassword: password,
        }),
      )
      onSessionChange(next)
      setCurrent('')
      setPassword('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Change password">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field
          label="Current master password"
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          disabled={busy}
        />
        <NewPasswordFields
          label="New master password"
          avoid={[session.username]}
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          onValidity={setValid}
          disabled={busy}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {done ? <Notice>Password changed. Your other devices were signed out.</Notice> : null}
        {busy ? (
          <p className="text-sm text-muted">Updating your keys. This takes a few seconds.</p>
        ) : null}
        <Button type="submit" disabled={busy || !current || !valid}>
          Change password
        </Button>
      </form>
    </Card>
  )
}
