import { prepareRecovery, type PreparedRecovery, type Session } from '@sm/client'
import { useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from './errors'
import { NewPasswordFields } from './NewPasswordFields'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'
import { Button, ButtonRow, Card, ErrorText, Field } from './ui'

type Step =
  { kind: 'form' } | { kind: 'working' } | { kind: 'recovery'; prepared: PreparedRecovery }

export function ForgotPassword({
  onSession,
  onBack,
}: {
  onSession: (s: Session, notice: string) => void
  onBack: () => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [username, setUsername] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordOk, setPasswordOk] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function begin() {
    setError(null)
    setStep({ kind: 'working' })
    try {
      const prepared = await prepareRecovery({
        api,
        kdf: workerKdf,
        username,
        recoveryKey,
        newPassword: password,
      })
      setPassword('')
      setConfirm('')
      setRecoveryKey('')
      setConfirmed(false)
      setStep({ kind: 'recovery', prepared })
    } catch (err) {
      setError(describeError(err))
      setStep({ kind: 'form' })
    }
  }

  async function finish(prepared: PreparedRecovery) {
    setSubmitting(true)
    setError(null)
    try {
      const session = await prepared.submit()
      onSession(
        session,
        'Your password was reset and a new recovery key was issued. Every other device was signed out.',
      )
    } catch (err) {
      setSubmitting(false)
      setError(describeError(err))
      setStep({ kind: 'form' })
    }
  }

  if (step.kind === 'working') {
    return (
      <Card title="Checking your recovery key">
        <p className="text-muted">
          Preparing your new keys on this device. This takes a few seconds.
        </p>
      </Card>
    )
  }

  if (step.kind === 'recovery') {
    const { prepared } = step
    return (
      <Card title="Save your new recovery key">
        <p className="text-sm">
          Your old recovery key stops working as soon as you finish. Save this new one before
          continuing. This step expires in {Math.round(prepared.expiresIn / 60)} minutes.
        </p>
        <RecoveryKeyPanel
          recoveryKey={prepared.recoveryKey}
          username={username}
          disabled={submitting}
          onConfirmedChange={setConfirmed}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <ButtonRow>
          <Button disabled={!confirmed || submitting} onClick={() => void finish(prepared)}>
            {submitting ? 'Resetting…' : 'Reset password and sign in'}
          </Button>
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => setStep({ kind: 'form' })}
          >
            Cancel
          </Button>
        </ButtonRow>
      </Card>
    )
  }

  return (
    <Card title="Forgot password">
      <p className="text-sm text-muted">
        Enter your recovery key and choose a new master password. Without the recovery key a vault
        cannot be opened, by anyone.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void begin()
        }}
      >
        <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
        <Field label="Recovery key" value={recoveryKey} onChange={setRecoveryKey} multiline mono />
        <NewPasswordFields
          label="New master password"
          avoid={[username]}
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          onValidity={setPasswordOk}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <ButtonRow>
          <Button type="submit" disabled={!username || !recoveryKey.trim() || !passwordOk}>
            Continue
          </Button>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        </ButtonRow>
      </form>
    </Card>
  )
}
