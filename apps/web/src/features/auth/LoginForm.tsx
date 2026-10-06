import { login, type Session } from '@sm/client'
import { useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from './errors'
import { Button, ErrorText, Field } from './ui'

export function LoginForm({
  onSession,
  onBack,
}: {
  onSession: (s: Session) => void
  onBack: () => void
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
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2 className="text-xl font-semibold">Log in</h2>
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
        <p className="text-sm text-slate-500">Unlocking your vault. This takes about a second.</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !username || !password}>
          Log in
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </div>
    </form>
  )
}
