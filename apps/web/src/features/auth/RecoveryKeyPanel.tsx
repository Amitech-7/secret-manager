import { confirmRecoveryTail } from '@sm/client'
import { useEffect, useState } from 'react'
import { Button, ButtonRow, Field } from './ui'

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Shows a recovery key and makes the person prove they saved it: a tick box plus retyping the
 * last five characters. Reports through onConfirmedChange when both are done.
 */
export function RecoveryKeyPanel(props: {
  recoveryKey: string
  username: string
  disabled?: boolean
  onConfirmedChange: (confirmed: boolean) => void
}) {
  const { recoveryKey, onConfirmedChange } = props
  const [saved, setSaved] = useState(false)
  const [tail, setTail] = useState('')

  useEffect(() => {
    onConfirmedChange(saved && confirmRecoveryTail(recoveryKey, tail))
  }, [saved, tail, recoveryKey, onConfirmedChange])

  return (
    <div className="space-y-4">
      <p
        className="rounded-lg border border-border-strong bg-raised p-3 text-center font-mono text-sm break-all"
        data-testid="recovery-key"
      >
        {recoveryKey}
      </p>
      <ButtonRow>
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard?.writeText(recoveryKey)}
        >
          Copy
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            downloadText(
              'secret-manager-recovery-key.txt',
              `Secret Manager recovery key\nUsername: ${props.username.trim().toLowerCase()}\n\n${recoveryKey}\n\nAnyone with this key can open your vault. Keep it private.\n`,
            )
          }
        >
          Download
        </Button>
      </ButtonRow>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0"
          checked={saved}
          disabled={props.disabled}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <span>I have saved my recovery key somewhere safe.</span>
      </label>
      <Field
        label="Type the last 5 characters to confirm"
        value={tail}
        onChange={setTail}
        disabled={props.disabled}
        hint="Case and dashes do not matter."
      />
    </div>
  )
}
