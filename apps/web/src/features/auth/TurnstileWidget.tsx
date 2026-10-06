import { useEffect, useRef, useState } from 'react'
import { loadTurnstile } from '../../lib/turnstile'

export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) {
      setProblem('The captcha is not configured on this deployment.')
      return
    }
    let widgetId: string | undefined
    let cancelled = false
    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        })
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : 'Captcha error'))
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, onToken])

  if (problem) return <p className="text-sm text-red-600">{problem}</p>
  return <div ref={container} />
}
