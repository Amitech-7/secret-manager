import type { ReactNode } from 'react'

export function Field(props: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{props.label}</span>
      <input
        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        type={props.type ?? 'text'}
        value={props.value}
        autoComplete={props.autoComplete}
        disabled={props.disabled}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint ? <span className="mt-1 block text-xs text-slate-500">{props.hint}</span> : null}
    </label>
  )
}

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const primary = props.variant !== 'secondary'
  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      className={
        'rounded px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50 ' +
        (primary
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'border border-slate-300 dark:border-slate-700')
      }
    >
      {props.children}
    </button>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  )
}
