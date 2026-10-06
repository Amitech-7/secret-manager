interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<void> | undefined

/** Loaded only when the register page needs it, so no third-party script runs on other pages. */
export function loadTurnstile(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    if (window.turnstile) return resolve()
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = undefined
      reject(new Error('The captcha could not be loaded.'))
    }
    document.head.append(script)
  })
  return loading
}
