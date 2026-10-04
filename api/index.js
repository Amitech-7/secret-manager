// Vercel entry. vercel.json rewrites /api/* here, and the original URL is preserved, so the
// Hono app (basePath /api/v1) sees the real path. The app is bundled to
// apps/api/dist/handler.mjs by the install step before Vercel builds functions.
import app from '../apps/api/dist/handler.mjs'

export default app
