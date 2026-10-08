import type { Session } from '@sm/client'
import { useEffect, useState } from 'react'
import { ForgotPassword } from './features/auth/ForgotPassword'
import { LoginForm } from './features/auth/LoginForm'
import { RegisterFlow } from './features/auth/RegisterFlow'
import { SignedIn } from './features/auth/SignedIn'
import { Button, ButtonRow, Card, Notice } from './features/auth/ui'
import { apiUrl } from './lib/api'
import { ThemeControls } from './theme/ThemeControls'

type View = 'home' | 'login' | 'register' | 'forgot'
type Health = 'checking' | 'ok' | 'down'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [health, setHealth] = useState<Health>('checking')
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL

  useEffect(() => {
    const controller = new AbortController()
    fetch(apiUrl('/health'), { signal: controller.signal })
      .then((res) => res.json() as Promise<{ status?: string }>)
      .then((body) => setHealth(body.status === 'ok' ? 'ok' : 'down'))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setHealth('down')
      })
    return () => controller.abort()
  }, [])

  const signOut = () => {
    setSession(null)
    setNotice(null)
    setView('home')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-4 py-2">
          <h1 className="text-lg font-semibold">Secret Manager</h1>
          <details className="relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-border-strong px-3 text-sm">
              Theme
            </summary>
            <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-lg">
              <ThemeControls />
            </div>
          </details>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6 sm:py-10">
        {session ? (
          <SignedIn
            session={session}
            notice={notice}
            onSessionChange={setSession}
            onLoggedOut={signOut}
          />
        ) : view === 'login' ? (
          <LoginForm
            onSession={(s) => {
              setNotice(null)
              setSession(s)
            }}
            onBack={() => setView('home')}
            onForgot={() => setView('forgot')}
          />
        ) : view === 'register' ? (
          <RegisterFlow
            onSession={(s) => {
              setNotice(null)
              setSession(s)
            }}
            onBack={() => setView('home')}
          />
        ) : view === 'forgot' ? (
          <ForgotPassword
            onSession={(s, message) => {
              setNotice(message)
              setSession(s)
            }}
            onBack={() => setView('login')}
          />
        ) : (
          <Card>
            <p>Keep your credentials and cards encrypted on your own device.</p>
            <ButtonRow>
              <Button onClick={() => setView('login')}>Log in</Button>
              <Button variant="secondary" onClick={() => setView('register')}>
                Register
              </Button>
            </ButtonRow>
            {notice ? <Notice>{notice}</Notice> : null}
          </Card>
        )}
      </main>

      <footer className="border-t border-border bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-4 py-3 text-sm">
          <span className="flex gap-4">
            <a
              className="inline-flex min-h-11 items-center text-link underline"
              href="https://github.com/"
            >
              Documentation
            </a>
            {session && contactEmail ? (
              <a
                className="inline-flex min-h-11 items-center text-link underline"
                href={`mailto:${contactEmail}`}
              >
                Contact Us
              </a>
            ) : null}
          </span>
          <span className="text-muted" data-testid="api-status">
            Server: {health}
          </span>
        </div>
      </footer>
    </div>
  )
}
