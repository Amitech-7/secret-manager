// The real API on a throwaway in-memory Postgres (PGlite) with the production migrations, and a
// captcha that always passes. Used only by the browser tests; it never touches Neon.
import { serve } from '@hono/node-server'
import { createApp } from '@sm/api/app'
import { harness } from '@sm/api/testkit'

const h = await harness()
// The test harness freezes its clock; browsers need real time so tokens and sessions behave.
const app = createApp({ ...h.deps, now: () => new Date() })

const port = Number(process.env.E2E_API_PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`E2E API listening on http://localhost:${port}/api/v1/health`)
