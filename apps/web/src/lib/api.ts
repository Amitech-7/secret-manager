/** Base URL is empty on the web (same origin) and set via VITE_API_URL for the mobile build. */
export function apiUrl(path: string, base: string = import.meta.env.VITE_API_URL ?? ''): string {
  const cleanBase = base.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}/api/v1${cleanPath}`
}
