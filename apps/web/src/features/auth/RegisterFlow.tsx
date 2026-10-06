import {
  ApiRequestError,
  checkPassword,
  confirmRecoveryTail,
  prepareRegistration,
  type PasswordCheck,
  type PreparedRegistration,
  type Session,
} from '@sm/client'
import { LIMITS, USERNAME_PATTERN } from '@sm/shared'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/client'
import { workerKdf } from '../../lib/workerKdf'
import { describeError } from './errors'
import { TurnstileWidget } from './TurnstileWidget'
import { Button, ErrorText, Field } from './ui'

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

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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
  const [strength, setStrength] = useState<PasswordCheck | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Recovery step state
  const [saved, setSaved] = useState(false)
  const [tail, setTail] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [widgetKey, setWidgetKey] = useState(0)
  const onToken = useCallback((t: string | null) => setToken(t), [])

  useEffect(() => {
    if (!password) {
      setStrength(null)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      void checkPassword(password, [username]).then((r) => {
        if (!stale) setStrength(r)
      })
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [password, username])

  const nameProblem = username ? usernameProblem(username) : null
  const formValid = username !== '' && !nameProblem && strength?.ok === true && password === confirm

  async function continueToRecovery() {
    setError(null)
    setStep({ kind: 'working' })
    try {
      const prepared = await prepareRegistration({ api, kdf: workerKdf, username, password })
      setPassword('')
      setConfirm('')
      setSaved(false)
      setTail('')
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
      if (err instanceof ApiRequestError && err.code === 'USERNAME_TAKEN') {
        // This key belonged to a registration that did not happen. Start over with a fresh one.
        setError(describeError(err))
        setStep({ kind: 'form' })
        return
      }
      setError(describeError(err))
      setToken(null)
      setWidgetKey((k) => k + 1) // a captcha token is single-use
    }
  }

  if (step.kind === 'working') {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Creating your keys</h2>
        <p className="text-slate-500">
          Your password is being turned into encryption keys on this device. This takes about a
          second.
        </p>
      </div>
    )
  }

  if (step.kind === 'recovery') {
    const { prepared } = step
    const ready = saved && confirmRecoveryTail(prepared.recoveryKey, tail) && token !== null
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Save your recovery key</h2>
        <p className="text-sm">
          If you forget your master password, this key is the <strong>only</strong> way back into
          your vault. Nobody else can reset it, including us. Store it somewhere safe and separate
          from this device.
        </p>
        <p
          className="rounded border border-slate-300 bg-slate-50 p-3 text-center font-mono text-sm break-all dark:border-slate-700 dark:bg-slate-900"
          data-testid="recovery-key"
        >
          {prepared.recoveryKey}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(prepared.recoveryKey)}
          >
            Copy
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              downloadText(
                'secret-manager-recovery-key.txt',
                `Secret Manager recovery key\nUsername: ${username.trim().toLowerCase()}\n\n${prepared.recoveryKey}\n\nAnyone with this key can open your vault. Keep it private.\n`,
              )
            }
          >
            Download
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
          />
          <span>I have saved my recovery key somewhere safe.</span>
        </label>
        <Field
          label="Type the last 5 characters to confirm"
          value={tail}
          onChange={setTail}
          disabled={submitting}
          hint="Case and dashes do not matter."
        />
        <TurnstileWidget key={widgetKey} onToken={onToken} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="flex gap-2">
          <Button disabled={!ready || submitting} onClick={() => void createAccount(prepared)}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => setStep({ kind: 'form' })}
          >
            Start over
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void continueToRecovery()
      }}
    >
      <h2 className="text-xl font-semibold">Create an account</h2>
      <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
      {nameProblem ? <ErrorText>{nameProblem}</ErrorText> : null}
      <Field
        label="Master password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint="At least 12 characters. A phrase of several unrelated words works well."
      />
      {strength ? (
        <p className={'text-sm ' + (strength.ok ? 'text-green-600' : 'text-red-600')}>
          {strength.message}
        </p>
      ) : null}
      <Field
        label="Confirm master password"
        type="password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
      {confirm && password !== confirm ? <ErrorText>The passwords do not match.</ErrorText> : null}
      <p className="text-sm text-slate-500">
        Your master password never leaves this device and cannot be reset. You will get a recovery
        key next.
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!formValid}>
          Continue
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  )
}
