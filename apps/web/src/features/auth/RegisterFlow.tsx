import {
  ApiRequestError,
  prepareRegistration,
  type PreparedRegistration,
  type Session,
} from '@sm/client'
import { LIMITS, USERNAME_PATTERN } from '@sm/shared'
import { useCallback, useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from './errors'
import { NewPasswordFields } from './NewPasswordFields'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'
import { TurnstileWidget } from './TurnstileWidget'
import { Button, ButtonRow, Card, ErrorText, Field } from './ui'

type Step =
  { kind: 'form' } | { kind: 'working' } | { kind: 'recovery'; prepared: PreparedRegistration }

const usernameProblem = (u: string): string | null => {
  const name = u.trim().toLowerCase()
  if (name.length < LIMITS.usernameMin || name.length > LIMITS.usernameMax) {
    return `Use ${LIMITS.usernameMin} to ${LIMITS.usernameMax} characters.`
  }
  return USERNAME_PATTERN.test(name)
    ? null
    : 'Use only letters, digits, dot, underscore and hyphen.'
}

export function RegisterFlow({
  onSession,
  onBack,
}: {
  onSession: (s: Session) => void
  onBack: () => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordOk, setPasswordOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [confirmed, setConfirmed] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [widgetKey, setWidgetKey] = useState(0)
  const onToken = useCallback((t: string | null) => setToken(t), [])

  const nameProblem = username ? usernameProblem(username) : null
  const formValid = username !== '' && !nameProblem && passwordOk

  async function continueToRecovery() {
    setError(null)
    setStep({ kind: 'working' })
    try {
      const prepared = await prepareRegistration({ api, kdf: workerKdf, username, password })
      setPassword('')
      setConfirm('')
      setConfirmed(false)
      setToken(null)
      setStep({ kind: 'recovery', prepared })
    } catch (err) {
      setError(describeError(err))
      setStep({ kind: 'form' })
    }
  }

  async function createAccount(prepared: PreparedRegistration) {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      onSession(await prepared.submit(token))
    } catch (err) {
      setSubmitting(false)
      setError(describeError(err))
      if (err instanceof ApiRequestError && err.code === 'USERNAME_TAKEN') {
        // This key belonged to a registration that did not happen. Start over with a fresh one.
        setStep({ kind: 'form' })
        return
      }
      setToken(null)
      setWidgetKey((k) => k + 1) // a captcha token is single-use
    }
  }

  if (step.kind === 'working') {
    return (
      <Card title="Creating your keys">
        <p className="text-muted">
          Your password is being turned into encryption keys on this device. This takes about a
          second.
        </p>
      </Card>
    )
  }

  if (step.kind === 'recovery') {
    const { prepared } = step
    return (
      <Card title="Save your recovery key">
        <p className="text-sm">
          If you forget your master password, this key is the <strong>only</strong> way back into
          your vault. Nobody else can reset it, including us. Store it somewhere safe and separate
          from this device.
        </p>
        <RecoveryKeyPanel
          recoveryKey={prepared.recoveryKey}
          username={username}
          disabled={submitting}
          onConfirmedChange={setConfirmed}
        />
        <TurnstileWidget key={widgetKey} onToken={onToken} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <ButtonRow>
          <Button
            disabled={!confirmed || token === null || submitting}
            onClick={() => void createAccount(prepared)}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => setStep({ kind: 'form' })}
          >
            Start over
          </Button>
        </ButtonRow>
      </Card>
    )
  }

  return (
    <Card title="Create an account">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void continueToRecovery()
        }}
      >
        <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
        {nameProblem ? <ErrorText>{nameProblem}</ErrorText> : null}
        <NewPasswordFields
          avoid={[username]}
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          onValidity={setPasswordOk}
        />
        <p className="text-sm text-muted">
          Your master password never leaves this device and cannot be reset. You will get a recovery
          key next.
        </p>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <ButtonRow>
          <Button type="submit" disabled={!formValid}>
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
