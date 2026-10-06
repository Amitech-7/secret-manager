import { logout, withFreshSession, type MeResponse, type Session } from '@sm/client'
import { useEffect, useState } from 'react'
import { api } from '../../lib/client'
import { describeError } from './errors'
import { Button, ErrorText } from './ui'

export function SignedIn({
  session,
  onSessionChange,
  onLoggedOut,
}: {
  session: Session
  onSessionChange: (s: Session) => void
  onLoggedOut: () => void
}) {
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

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Signed in as {session.username}</h2>
      <p className="text-green-600">Your vault is unlocked on this device.</p>
      {me ? (
        <p className="text-sm text-slate-500">
          {me.itemCount} of {me.itemQuota} items stored. Vault screens arrive in the next
          milestones.
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button variant="secondary" onClick={() => void logOut()}>
        Log out
      </Button>
    </div>
  )
}
