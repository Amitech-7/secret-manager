import {
  prepareRecoveryRotation,
  withFreshSession,
  type PreparedRecoveryKeyChange,
  type Session,
} from '@sm/client'
import { useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from '../auth/errors'
import { RecoveryKeyPanel } from '../auth/RecoveryKeyPanel'
import { Button, ButtonRow, Card, ErrorText, Field, Notice } from '../auth/ui'

type Step =
  | { kind: 'idle' }
  | { kind: 'password' }
  | { kind: 'working' }
  | { kind: 'show'; prepared: PreparedRecoveryKeyChange }

export function RotateRecoveryKey({
  session,
  onSessionChange,
}: {
  session: Session
  onSessionChange: (s: Session) => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function prepare() {
    setError(null)
    setDone(false)
    setStep({ kind: 'working' })
    try {
      const { result, session: next } = await withFreshSession(session, { api }, (accessToken) =>
        prepareRecoveryRotation({ api, kdf: workerKdf, accessToken, password }),
      )
      onSessionChange(next)
      setPassword('')
      setConfirmed(false)
      setStep({ kind: 'show', prepared: result })
    } catch (err) {
      setError(describeError(err))
      setStep({ kind: 'password' })
    }
  }

  async function finish(prepared: PreparedRecoveryKeyChange) {
    setBusy(true)
    setError(null)
    try {
      const { session: next } = await withFreshSession(session, { api }, (token) =>
        prepared.submit(token),
      )
      onSessionChange(next)
      setDone(true)
      setStep({ kind: 'idle' })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Recovery key">
      {step.kind === 'idle' ? (
        <>
          <p className="text-sm text-muted">
            The recovery key is the only way back in if you forget your master password. Replace it
            if you think it may have been seen or lost. The old key stops working as soon as you
            finish.
          </p>
          {done ? (
            <Notice>Your recovery key was replaced. The old one no longer works.</Notice>
          ) : null}
          <Button variant="secondary" onClick={() => setStep({ kind: 'password' })}>
            Replace recovery key
          </Button>
        </>
      ) : null}

      {step.kind === 'password' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void prepare()
          }}
        >
          <Field
            label="Master password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <ButtonRow>
            <Button type="submit" disabled={!password}>
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setStep({ kind: 'idle' })}>
              Cancel
            </Button>
          </ButtonRow>
        </form>
      ) : null}

      {step.kind === 'working' ? (
        <p className="text-muted">Preparing your new key. This takes a second.</p>
      ) : null}

      {step.kind === 'show' ? (
        <>
          <p className="text-sm">
            Save this new key. Your current recovery key keeps working until you finish.
          </p>
          <RecoveryKeyPanel
            recoveryKey={step.prepared.recoveryKey}
            username={session.username}
            disabled={busy}
            onConfirmedChange={setConfirmed}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <ButtonRow>
            <Button disabled={!confirmed || busy} onClick={() => void finish(step.prepared)}>
              {busy ? 'Saving…' : 'Use this key'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setStep({ kind: 'idle' })}>
              Cancel
            </Button>
          </ButtonRow>
        </>
      ) : null}
    </Card>
  )
}
