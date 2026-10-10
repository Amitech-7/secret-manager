import { applyImport, exportVault, previewImport, type ImportPlan, type Session } from '@sm/client'
import { useRef, useState } from 'react'
import { api } from '../../lib/client'
import { downloadTextFile, readBackupFile } from '../../lib/download'
import { workerKdf } from '../../lib/workerKdf'
import { Button, ButtonRow, Card, ErrorText, Field, Notice } from '../auth/ui'
import { describeBackupError, plural, summarizePlan } from './backupView'

const MIN_PASSPHRASE = 12

export function BackupScreen({
  session,
  onSessionChange,
  onBack,
}: {
  session: Session
  onSessionChange: (s: Session) => void
  onBack: () => void
}) {
  const latest = useRef(session)
  latest.current = session
  const adopt = (next: Session) => {
    if (next !== latest.current) {
      latest.current = next
      onSessionChange(next)
    }
  }
  const options = { api, kdf: workerKdf }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Backup</h2>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
      <ExportCard getSession={() => latest.current} adopt={adopt} options={options} />
      <ImportCard getSession={() => latest.current} adopt={adopt} options={options} />
    </div>
  )
}

interface CardProps {
  getSession: () => Session
  adopt: (s: Session) => void
  options: { api: typeof api; kdf: typeof workerKdf }
}

function ExportCard({ getSession, adopt, options }: CardProps) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ count: number; unreadable: number } | null>(null)

  const ready = pass.length >= MIN_PASSPHRASE && pass === confirm

  async function run() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const out = await exportVault(getSession(), options, pass)
      adopt(out.session)
      downloadTextFile(out.fileName, out.file)
      setDone({ count: out.itemCount, unreadable: out.unreadable.length })
      setPass('')
      setConfirm('')
    } catch (err) {
      setError(describeBackupError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Export">
      <p className="text-sm">
        Saves everything in your vault to an encrypted file on this device. The file is locked with
        a backup passphrase you choose now. It is not your master password, so it keeps working if
        you change that later.
      </p>
      <Notice>
        If you lose the backup passphrase, the file cannot be opened by anyone, including us. Keep
        it in a password manager and keep the file somewhere private.
      </Notice>
      <Field
        label="Backup passphrase"
        type="password"
        value={pass}
        onChange={setPass}
        autoComplete="new-password"
        hint={`At least ${MIN_PASSPHRASE} characters.`}
        disabled={busy}
      />
      <Field
        label="Repeat the passphrase"
        type="password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        disabled={busy}
      />
      {confirm && pass !== confirm ? (
        <ErrorText>The two passphrases do not match.</ErrorText>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {done ? (
        <Notice>
          Backup saved with {done.count} item{done.count === 1 ? '' : 's'}.
          {done.unreadable > 0
            ? ` ${done.unreadable} item${done.unreadable === 1 ? '' : 's'} could not be opened on this device and ${done.unreadable === 1 ? 'is' : 'are'} not in the file.`
            : ''}
        </Notice>
      ) : null}
      <Button disabled={busy || !ready} onClick={() => void run()}>
        {busy ? 'Creating backup…' : 'Create backup file'}
      </Button>
    </Card>
  )
}

type Stage = 'pick' | 'checking' | 'review' | 'importing' | 'done'

function ImportCard({ getSession, adopt, options }: CardProps) {
  const [file, setFile] = useState<File | null>(null)
  const [pass, setPass] = useState('')
  const [stage, setStage] = useState<Stage>('pick')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null)

  async function check() {
    if (!file) return
    setStage('checking')
    setError(null)
    try {
      const text = await readBackupFile(file)
      const out = await previewImport(getSession(), options, pass, text)
      adopt(out.session)
      setPlan(out.plan)
      setOverwrite(false)
      setStage('review')
    } catch (err) {
      setError(describeBackupError(err))
      setStage('pick')
    }
  }

  async function run() {
    if (!plan) return
    setStage('importing')
    setError(null)
    try {
      const out = await applyImport(getSession(), options, plan, {
        overwrite,
        onProgress: (done, total) => setProgress([done, total]),
      })
      adopt(out.session)
      setResult({ created: out.created, updated: out.updated })
      setPass('')
      setStage('done')
    } catch (err) {
      // Safe to retry: importing again only adds what is still missing.
      setError(
        `${describeBackupError(err)} Some items may already have been added; you can run the import again.`,
      )
      setStage('review')
    }
  }

  const reset = () => {
    setFile(null)
    setPlan(null)
    setResult(null)
    setError(null)
    setStage('pick')
  }

  const s = plan ? summarizePlan(plan) : null
  const nothingToDo =
    !plan || (plan.creates.length === 0 && !(overwrite && plan.updates.length > 0))

  return (
    <Card title="Import">
      {stage === 'done' && result ? (
        <>
          <Notice>
            Import finished: {result.created} added
            {result.updated > 0 ? `, ${result.updated} replaced` : ''}.
          </Notice>
          <Button variant="secondary" onClick={reset}>
            Import another file
          </Button>
        </>
      ) : stage === 'review' && plan && s ? (
        <>
          <p className="text-sm">Nothing has been changed yet. Here is what this file would do:</p>
          <ul className="space-y-1 text-sm">
            <li>
              <strong>{s.total}</strong> to add ({plural(s.newCredentials, 'credential')},{' '}
              {plural(s.newCards, 'card')}, {plural(s.newListEntries, 'list entry', 'list entries')}
              )
            </li>
            <li>
              <strong>{s.alreadyThere}</strong> already in your vault
            </li>
            <li>
              <strong>{s.different}</strong> in your vault that differ from the backup
            </li>
            {s.skipped > 0 ? (
              <li>
                <strong>{s.skipped}</strong> in the file could not be used
              </li>
            ) : null}
          </ul>
          {plan.invalid.length > 0 ? (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2">Why were they skipped?</summary>
              <ul className="list-disc space-y-1 pl-5">
                {plan.invalid.slice(0, 10).map((i, n) => (
                  <li key={n}>
                    {i.type}: {i.reason}
                  </li>
                ))}
                {plan.invalid.length > 10 ? <li>and {plan.invalid.length - 10} more</li> : null}
              </ul>
            </details>
          ) : null}
          {plan.overQuota ? (
            <ErrorText>
              Adding {s.total} items would pass your limit of 1,000. Delete some items first.
            </ErrorText>
          ) : null}
          {s.different > 0 ? (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">For the {s.different} that differ</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="differ"
                  checked={!overwrite}
                  onChange={() => setOverwrite(false)}
                />
                Keep what is in my vault
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="differ"
                  checked={overwrite}
                  onChange={() => setOverwrite(true)}
                />
                Replace with the backup&apos;s version
              </label>
            </fieldset>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <ButtonRow>
            <Button disabled={plan.overQuota || nothingToDo} onClick={() => void run()}>
              Import
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </ButtonRow>
        </>
      ) : stage === 'importing' ? (
        <p role="status">
          Importing… {progress[0]} of {progress[1]}
        </p>
      ) : (
        <>
          <p className="text-sm">
            Add the contents of a backup file. Items you already have are left alone unless you
            choose otherwise, and you see a summary before anything changes.
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Backup file</span>
            <input
              type="file"
              accept=".smvault,application/json,application/octet-stream"
              disabled={stage === 'checking'}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block min-h-11 w-full text-sm"
            />
          </label>
          <Field
            label="Backup passphrase"
            type="password"
            value={pass}
            onChange={setPass}
            autoComplete="off"
            disabled={stage === 'checking'}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button
            disabled={!file || pass.length === 0 || stage === 'checking'}
            onClick={() => void check()}
          >
            {stage === 'checking' ? 'Checking file…' : 'Check file'}
          </Button>
        </>
      )}
    </Card>
  )
}
