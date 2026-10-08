import type { ReactNode } from 'react'

/** Shared building blocks. Phone-first: 44px touch targets, 16px inputs (stops iOS zooming in). */

export function Field(props: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  hint?: string
  disabled?: boolean
  multiline?: boolean
  mono?: boolean
}) {
  const className =
    'w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg disabled:opacity-60 ' +
    (props.multiline ? 'min-h-24 py-2 ' : 'min-h-11 ') +
    (props.mono ? 'font-mono text-sm ' : '')
  const common = {
    className,
    value: props.value,
    autoComplete: props.autoComplete,
    disabled: props.disabled,
    autoCapitalize: 'none' as const,
    autoCorrect: 'off',
    spellCheck: false,
  }
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{props.label}</span>
      {props.multiline ? (
        <textarea {...common} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          type={props.type ?? 'text'}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      {props.hint ? <span className="mt-1 block text-xs text-muted">{props.hint}</span> : null}
    </label>
  )
}

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-raised',
  danger: 'border border-danger bg-surface text-danger hover:bg-raised',
}

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  variant?: Variant
}) {
  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      className={
        'min-h-11 w-full rounded-lg px-4 font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ' +
        VARIANTS[props.variant ?? 'primary']
      }
    >
      {props.children}
    </button>
  )
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row">{children}</div>
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-lg bg-accent-subtle p-3 text-sm text-fg">
      {children}
    </p>
  )
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  )
}
