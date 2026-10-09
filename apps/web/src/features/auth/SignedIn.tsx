import { logout, type Session } from '@sm/client'
import { useRef, useState } from 'react'
import { api } from '../../lib/client'
import { useIdleLogout } from '../../lib/useIdleLogout'
import { SecurityScreen } from '../security/SecurityScreen'
import { VaultScreen } from '../vault/VaultScreen'
import { Button, ButtonRow, Notice } from './ui'

export function SignedIn({
  session,
  notice,
  onSessionChange,
  onLoggedOut,
}: {
  session: Session
  notice?: string | null
  onSessionChange: (s: Session) => void
  onLoggedOut: (message?: string) => void
}) {
  const [screen, setScreen] = useState<'home' | 'settings'>('home')
  const latest = useRef(session)
  latest.current = session

  async function logOut(message?: string) {
    // The vault key lives only in memory, so dropping the session locks the vault at once.
    // Always use the newest session: the refresh token rotates, and an old one would be refused.
    await logout(latest.current, { api }).catch(() => undefined)
    onLoggedOut(message)
  }

  useIdleLogout(() => void logOut('You were logged out after a period of inactivity.'))

  if (screen === 'settings') {
    return (
      <SecurityScreen
        session={session}
        onSessionChange={onSessionChange}
        onBack={() => setScreen('home')}
        onDeleted={() => onLoggedOut()}
      />
    )
  }

  return (
    <div className="space-y-4">
      {notice ? <Notice>{notice}</Notice> : null}
      <p className="text-sm text-muted">Signed in as {session.username}</p>
      <VaultScreen session={session} onSessionChange={onSessionChange} />
      <ButtonRow>
        <Button variant="secondary" onClick={() => setScreen('settings')}>
          Settings
        </Button>
        <Button variant="secondary" onClick={() => void logOut()}>
          Log out
        </Button>
      </ButtonRow>
    </div>
  )
}
