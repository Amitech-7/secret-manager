import type { VaultItem } from '@sm/client'
import { useEffect, useRef, useState } from 'react'
import { copySecret, CLIPBOARD_CLEAR_MS } from '../../lib/clipboard'
import { SmallButton } from './controls'
import {
  accountInfo,
  bankName,
  formatCardNumber,
  formatMonth,
  isCardExpired,
  maskCardNumber,
  type Split,
} from './vaultView'

const REVEAL_MS = 15_000
const HIDDEN_DOTS = '••••••••' // fixed length, so the real length is not revealed

type Of<T extends VaultItem['type']> = Extract<VaultItem, { type: T }>

function useCopyStatus() {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy(value: string) {
    const ok = await copySecret(value)
    setCopied(ok ? 'ok' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied('idle'), 4000)
  }
  return { copied, copy }
}

/** A value that can be copied but is never shown. */
function CopyRow(props: { label: string; value: string; display?: string }) {
  const { copied, copy } = useCopyStatus()
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted">{props.label}</p>
        <p className="break-all">{props.display ?? props.value}</p>
      </div>
      <SmallButton onClick={() => void copy(props.value)} label={`Copy ${props.label}`}>
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
      </SmallButton>
    </div>
  )
}

/** A secret: hidden by default, shown for 15 seconds on request, copyable either way. */
function SecretRow(props: { label: string; masked: string; shown: string; copyValue: string }) {
  const [revealed, setRevealed] = useState(false)
  const { copied, copy } = useCopyStatus()
  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => setRevealed(false), REVEAL_MS)
    return () => clearTimeout(t)
  }, [revealed])

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">{props.label}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-all font-mono text-sm" aria-live="polite">
          {revealed ? props.shown : props.masked}
        </p>
        <div className="flex gap-2">
          <SmallButton
            onClick={() => setRevealed((v) => !v)}
            label={`${revealed ? 'Hide' : 'Show'} ${props.label}`}
          >
            {revealed ? 'Hide' : 'Show'}
          </SmallButton>
          <SmallButton onClick={() => void copy(props.copyValue)} label={`Copy ${props.label}`}>
            {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
          </SmallButton>
        </div>
      </div>
      {copied === 'ok' ? (
        <p className="text-xs text-muted">
          Copied. The clipboard is cleared after {CLIPBOARD_CLEAR_MS / 1000} seconds.
        </p>
      ) : null}
    </div>
  )
}

export function CredentialCard(props: {
  item: Of<'credential'>
  split: Split
  onEdit: () => void
  onDelete: () => void
}) {
  const { payload } = props.item
  const account = accountInfo(props.split, payload.accountId)
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <p className="font-semibold">{account.name}</p>
        {account.typeName ? <p className="text-xs text-muted">{account.typeName}</p> : null}
      </div>
      <CopyRow label="Username" value={payload.username} />
      <SecretRow
        label="Password"
        masked={HIDDEN_DOTS}
        shown={payload.password}
        copyValue={payload.password}
      />
      {payload.hint || payload.remark || payload.expiryDate ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2">More details</summary>
          <dl className="space-y-1">
            {payload.hint ? <Detail term="Hint" value={payload.hint} /> : null}
            {payload.remark ? <Detail term="Remark" value={payload.remark} /> : null}
            {payload.expiryDate ? <Detail term="Expires" value={payload.expiryDate} /> : null}
          </dl>
        </details>
      ) : null}
      <div className="flex gap-2">
        <SmallButton onClick={props.onEdit}>Edit</SmallButton>
        <SmallButton danger onClick={props.onDelete}>
          Delete
        </SmallButton>
      </div>
    </li>
  )
}

export function CardCard(props: {
  item: Of<'card'>
  split: Split
  now: Date
  onEdit: () => void
  onDelete: () => void
}) {
  const { payload } = props.item
  const expired = isCardExpired(payload.expiryDate, props.now)
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <p className="font-semibold">{payload.cardName}</p>
        <p className="text-xs text-muted">
          {bankName(props.split, payload.bankId)} · {payload.nameOnCard}
        </p>
      </div>
      <SecretRow
        label="Card number"
        masked={maskCardNumber(payload.number)}
        shown={formatCardNumber(payload.number)}
        copyValue={payload.number}
      />
      <CopyRow
        label="Expiry"
        value={formatMonth(payload.expiryDate)}
        display={expired ? `${formatMonth(payload.expiryDate)} (expired)` : undefined}
      />
      <SecretRow label="CVV" masked={HIDDEN_DOTS} shown={payload.cvv} copyValue={payload.cvv} />
      {payload.initialDate || payload.remark ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2">More details</summary>
          <dl className="space-y-1">
            {payload.initialDate ? (
              <Detail term="Valid from" value={formatMonth(payload.initialDate)} />
            ) : null}
            {payload.remark ? <Detail term="Remark" value={payload.remark} /> : null}
          </dl>
        </details>
      ) : null}
      <div className="flex gap-2">
        <SmallButton onClick={props.onEdit}>Edit</SmallButton>
        <SmallButton danger onClick={props.onDelete}>
          Delete
        </SmallButton>
      </div>
    </li>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted">{term}:</dt>
      <dd className="break-all">{value}</dd>
    </div>
  )
}
