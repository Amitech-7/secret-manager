import type { Session } from '@sm/client'
import { useRef } from 'react'
import { useIdleLogout } from '../../lib/useIdleLogout'
import type { Screen } from '../account/menuModel'
import { BackupScreen } from '../backup/BackupScreen'
import { SecurityScreen } from '../security/SecurityScreen'
import { VaultScreen } from '../vault/VaultScreen'
import { Notice } from './ui'

export function SignedIn({
  session,
  notice,
  screen,
  onScreenChange,
  onSessionChange,
  onLogOut,
  onAccountDeleted,
}: {
  session: Session
  notice?: string | null
  screen: Screen
  onScreenChange: (screen: Screen) => void
  onSessionChange: (s: Session) => void
  onLogOut: (message?: string) => Promise<void>
  onAccountDeleted: () => void
}) {
  const latest = useRef(onLogOut)
  latest.current = onLogOut
  useIdleLogout(() => void latest.current('You were logged out after a period of inactivity.'))

  const back = () => onScreenChange('vault')

  if (screen === 'settings') {
    return (
      <SecurityScreen
        session={session}
        onSessionChange={onSessionChange}
        onBack={back}
        onDeleted={onAccountDeleted}
      />
    )
  }
  if (screen === 'backup') {
    return <BackupScreen session={session} onSessionChange={onSessionChange} onBack={back} />
  }
  return (
    <div className="space-y-4">
      {notice ? <Notice>{notice}</Notice> : null}
      <VaultScreen session={session} onSessionChange={onSessionChange} />
    </div>
  )
}
