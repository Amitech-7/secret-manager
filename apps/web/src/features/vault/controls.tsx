import type { ReactNode } from 'react'

export function Select(props: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{props.label}</span>
      <select
        className="min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg disabled:opacity-60"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Tabs<T extends string>(props: {
  value: T
  onChange: (value: T) => void
  tabs: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
      {props.tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={props.value === t.value}
          onClick={() => props.onChange(t.value)}
          className={
            'min-h-11 rounded-lg px-3 text-sm font-medium ' +
            (props.value === t.value ? 'bg-accent text-on-accent' : 'text-fg hover:bg-surface')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** A compact action button inside cards (still 44px tall for thumbs). */
export function SmallButton(props: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      className={
        'min-h-11 rounded-lg border px-3 text-sm font-medium hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 ' +
        (props.danger ? 'border-danger text-danger' : 'border-border-strong text-fg')
      }
    >
      {props.children}
    </button>
  )
}
