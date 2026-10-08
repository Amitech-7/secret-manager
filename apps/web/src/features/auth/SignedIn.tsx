import { logout, withFreshSession, type MeResponse, type Session } from '@sm/client'
import { useEffect, useState } from 'react'
import { api } from '../../lib/client'
import { SecurityScreen } from '../security/SecurityScreen'
import { describeError } from './errors'
import { Button, ButtonRow, Card, ErrorText, Notice } from './ui'

export function SignedIn({
  session,
  notice,
  onSessionChange,
  onLoggedOut,
}: {
  session: Session
  notice?: string | null
  onSessionChange: (s: Session) => void
  onLoggedOut: () => void
}) {
  const [screen, setScreen] = useState<'home' | 'settings'>('home')
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    withFreshSession(session, { api }, (token) => api.me(token))
      .then(({ result, session: next }) => {
        if (cancelled) return
        setMe(result)
        if (next !== session) onSessionChange(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err))
      })
    return () => {
      cancelled = true
    }
    // Runs once per signed-in view; later token refreshes must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function logOut() {
    // The vault key lives only in memory, so dropping the session locks the vault at once.
    await logout(session, { api }).catch(() => undefined)
    onLoggedOut()
  }

  if (screen === 'settings') {
    return (
      <SecurityScreen
        session={session}
        onSessionChange={onSessionChange}
        onBack={() => setScreen('home')}
        onDeleted={onLoggedOut}
      />
    )
  }

  return (
    <div className="space-y-4">
      {notice ? <Notice>{notice}</Notice> : null}
      <Card title={`Signed in as ${session.username}`}>
        <p className="text-success">Your vault is unlocked on this device.</p>
        {me ? (
          <p className="text-sm text-muted">
            {me.itemCount} of {me.itemQuota} items stored. Vault screens arrive in the next
            milestones.
          </p>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <ButtonRow>
          <Button variant="secondary" onClick={() => setScreen('settings')}>
            Settings
          </Button>
          <Button variant="secondary" onClick={() => void logOut()}>
            Log out
          </Button>
        </ButtonRow>
      </Card>
    </div>
  )
}
