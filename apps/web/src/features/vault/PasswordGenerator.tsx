import {
  DEFAULT_GENERATOR,
  GENERATOR_LIMITS,
  estimateBits,
  generatePassword,
  type GeneratorOptions,
} from '@sm/crypto'
import { useState } from 'react'
import { Button, ButtonRow, ErrorText } from '../auth/ui'

const KINDS: ReadonlyArray<{ key: 'lower' | 'upper' | 'digits' | 'symbols'; label: string }> = [
  { key: 'lower', label: 'Lowercase (a-z)' },
  { key: 'upper', label: 'Uppercase (A-Z)' },
  { key: 'digits', label: 'Numbers (0-9)' },
  { key: 'symbols', label: 'Symbols (! # $ % & * + - = ? @ ^ _)' },
]

/** Makes a random password in the browser. Nothing here is stored or sent anywhere. */
export function PasswordGenerator({ onUse }: { onUse: (password: string) => void }) {
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<string | null>(null)

  const change = (next: Partial<GeneratorOptions>) => {
    setOptions((o) => ({ ...o, ...next }))
    setPreview('') // an old preview no longer matches the settings
    setError(null)
  }
  const anyKind = options.lower || options.upper || options.digits || options.symbols

  function generate() {
    try {
      setPreview(generatePassword(options))
      setError(null)
    } catch {
      setPreview('')
      setError('Choose at least one kind of character.')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Length: {options.length}</span>
        <input
          type="range"
          min={GENERATOR_LIMITS.minLength}
          max={GENERATOR_LIMITS.maxLength}
          value={options.length}
          onChange={(e) => change({ length: Number(e.target.value) })}
          className="min-h-11 w-full"
        />
      </label>
      {KINDS.map((k) => (
        <label key={k.key} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={options[k.key]}
            onChange={(e) => change({ [k.key]: e.target.checked })}
          />
          {k.label}
        </label>
      ))}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={options.avoidAmbiguous}
          onChange={(e) => change({ avoidAmbiguous: e.target.checked })}
        />
        Avoid look-alike characters (0 O o 1 l I |)
      </label>

      {preview ? (
        <div className="space-y-1">
          <p
            className="break-all rounded-lg bg-raised p-3 font-mono text-sm"
            data-testid="generated"
          >
            {preview}
          </p>
          <p className="text-xs text-muted">About {estimateBits(options)} bits of randomness.</p>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ButtonRow>
        <Button variant="secondary" disabled={!anyKind} onClick={generate}>
          {preview ? 'Generate another' : 'Generate'}
        </Button>
        {preview ? (
          <Button
            onClick={() => {
              onUse(preview)
              setPreview('')
            }}
          >
            Use this password
          </Button>
        ) : null}
      </ButtonRow>
    </div>
  )
}
