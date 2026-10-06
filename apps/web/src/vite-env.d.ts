/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Empty on the web (same origin); the full API origin for the mobile build. */
  readonly VITE_API_URL?: string
  /** Cloudflare Turnstile site key (public). */
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** Where the Contact Us link sends mail. Hidden when unset. */
  readonly VITE_CONTACT_EMAIL?: string
}
