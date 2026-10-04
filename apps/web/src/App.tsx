import { useEffect, useState } from 'react'
import { apiUrl } from './lib/api'

type Status = 'checking' | 'ok' | 'down'

export default function App() {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    const controller = new AbortController()
    fetch(apiUrl('/health'), { signal: controller.signal })
      .then((res) => res.json() as Promise<{ status?: string }>)
      .then((body) => setStatus(body.status === 'ok' ? 'ok' : 'down'))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setStatus('down')
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-lg font-semibold">Secret Manager</h1>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <p className="mb-4">Milestone M0: foundations are wired up.</p>
        <p>
          API status:{' '}
          <span
            data-testid="api-status"
            className={
              status === 'ok'
                ? 'font-medium text-green-600'
                : status === 'down'
                  ? 'font-medium text-red-600'
                  : 'text-slate-500'
            }
          >
            {status}
          </span>
        </p>
      </main>

      <footer className="border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
        <a className="underline" href="https://github.com/">
          Documentation
        </a>
      </footer>
    </div>
  )
}
