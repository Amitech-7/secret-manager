import { login, type Session } from '@sm/client'
import { useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from './errors'
import { Button, ButtonRow, Card, ErrorText, Field } from './ui'

export function LoginForm({
  onSession,
  onBack,
  onForgot,
}: {
  onSession: (s: Session) => void
  onBack: () => void
  onForgot: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const session = await login({ api, kdf: workerKdf, username, password })
      setPassword('')
      onSession(session)
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }

  return (
    <Card title="Log in">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          disabled={busy}
        />
        <Field
          label="Master password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {busy ? (
          <p className="text-sm text-muted">Unlocking your vault. This takes about a second.</p>
        ) : null}
        <ButtonRow>
          <Button type="submit" disabled={busy || !username || !password}>
            Log in
          </Button>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
        </ButtonRow>
        <button
          type="button"
          onClick={onForgot}
          disabled={busy}
          className="min-h-11 text-sm text-link underline"
        >
          Forgot password?
        </button>
      </form>
    </Card>
  )
}
