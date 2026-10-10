// Serves the production build of the web app with the headers from vercel.json and forwards
// /api to the test API, so the browser tests run against what will actually be deployed.
// Both Content-Security-Policy headers are ENFORCED here, even though the full one ships as
// report-only: a test that passes under enforcement proves flipping the switch is safe.
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173)
const API_PORT = Number(process.env.E2E_API_PORT ?? 8787)
const DIST = resolve(import.meta.dirname, '../web/dist')

const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../vercel.json'), 'utf8'),
) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
}

const securityHeaders: Record<string, string | string[]> = {}
for (const { key, value } of config.headers.flatMap((g) => g.headers)) {
  const name = key === 'Content-Security-Policy-Report-Only' ? 'Content-Security-Policy' : key
  const existing = securityHeaders[name]
  securityHeaders[name] = existing === undefined ? value : [existing].flat().concat(value)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

function proxy(req: IncomingMessage, res: ServerResponse) {
  const upstream = request(
    { host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.writeHead(502).end('API unavailable')
  })
  req.pipe(upstream)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) return proxy(req, res)

  // Same as the vercel.json rewrite: real files are served, everything else is the app.
  const requested = normalize(join(DIST, decodeURIComponent(url.pathname)))
  const isFile = requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile()
  const file = isFile ? requested : join(DIST, 'index.html')

  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value)
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
}).listen(WEB_PORT, () => console.log(`E2E web (production build) on http://localhost:${WEB_PORT}`))
