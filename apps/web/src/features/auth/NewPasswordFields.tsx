import { checkPassword, type PasswordCheck } from '@sm/client'
import { useEffect, useState } from 'react'
import { ErrorText, Field } from './ui'

/** Password + confirmation with the strength rule. Reports whether the pair is acceptable. */
export function NewPasswordFields(props: {
  label?: string
  /** Words the password must not be built from (username etc.). */
  avoid?: string[]
  password: string
  confirm: string
  onPassword: (v: string) => void
  onConfirm: (v: string) => void
  onValidity: (valid: boolean) => void
  disabled?: boolean
}) {
  const { password, confirm, avoid, onValidity } = props
  const [strength, setStrength] = useState<PasswordCheck | null>(null)
  const avoidKey = (avoid ?? []).join('\u0000')

  useEffect(() => {
    setStrength(null)
    if (!password) return
    let stale = false
    const timer = setTimeout(() => {
      void checkPassword(password, avoidKey ? avoidKey.split('\u0000') : []).then((r) => {
        if (!stale) setStrength(r)
      })
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [password, avoidKey])

  const matches = password === confirm
  useEffect(() => {
    onValidity(strength?.ok === true && matches && password !== '')
  }, [strength, matches, password, onValidity])

  const label = props.label ?? 'Master password'
  return (
    <>
      <Field
        label={label}
        type="password"
        value={password}
        onChange={props.onPassword}
        autoComplete="new-password"
        disabled={props.disabled}
        hint="At least 12 characters. A phrase of several unrelated words works well."
      />
      {strength ? (
        <p className={'text-sm ' + (strength.ok ? 'text-success' : 'text-danger')}>
          {strength.message}
        </p>
      ) : null}
      <Field
        label={`Confirm ${label.toLowerCase()}`}
        type="password"
        value={confirm}
        onChange={props.onConfirm}
        autoComplete="new-password"
        disabled={props.disabled}
      />
      {confirm && !matches ? <ErrorText>The passwords do not match.</ErrorText> : null}
    </>
  )
}
