// Vercel entry. The Hono app is bundled to apps/api/dist/handler.mjs by the install step in
// vercel.json, so it exists before Vercel builds functions. A default export with a `fetch`
// method is Vercel's web-standard function format (Hono apps qualify).
import app from '../apps/api/dist/handler.mjs'

export default app
