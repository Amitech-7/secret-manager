import type { Session } from '@sm/client'
import { useEffect, useState } from 'react'
import { LoginForm } from './features/auth/LoginForm'
import { RegisterFlow } from './features/auth/RegisterFlow'
import { SignedIn } from './features/auth/SignedIn'
import { Button } from './features/auth/ui'
import { apiUrl } from './lib/api'

type View = 'home' | 'login' | 'register'
type Health = 'checking' | 'ok' | 'down'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [session, setSession] = useState<Session | null>(null)
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
    setView('home')
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-lg font-semibold">Secret Manager</h1>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        {session ? (
          <SignedIn session={session} onSessionChange={setSession} onLoggedOut={signOut} />
        ) : view === 'login' ? (
          <LoginForm onSession={setSession} onBack={() => setView('home')} />
        ) : view === 'register' ? (
          <RegisterFlow onSession={setSession} onBack={() => setView('home')} />
        ) : (
          <div className="space-y-4">
            <p>Keep your credentials and cards encrypted on your own device.</p>
            <div className="flex gap-2">
              <Button onClick={() => setView('login')}>Log in</Button>
              <Button variant="secondary" onClick={() => setView('register')}>
                Register
              </Button>
            </div>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
        <span className="flex gap-4">
          <a className="underline" href="https://github.com/">
            Documentation
          </a>
          {session && contactEmail ? (
            <a className="underline" href={`mailto:${contactEmail}`}>
              Contact Us
            </a>
          ) : null}
        </span>
        <span className="text-slate-500" data-testid="api-status">
          Server: {health}
        </span>
      </footer>
    </div>
  )
}
