# Secret Manager

Zero-knowledge secrets vault (credentials and cards). Secrets are encrypted in the browser;
the server stores only ciphertext. **Not independently audited.**

Stack: React + Vite + Tailwind, Hono API on Vercel, Neon Postgres + Drizzle, WebCrypto + Argon2id.

## Prerequisites

- Node.js 22+
- pnpm (`npm i -g pnpm@12.9.1`)
- gitleaks (Windows: `winget install gitleaks.gitleaks`; macOS: `brew install gitleaks`)

## Develop

```sh
pnpm install
pnpm dev          # web on http://localhost:5173, API on http://localhost:8787
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Layout

- `apps/web` React SPA
- `apps/api` Hono API (bundled for Vercel to `apps/api/dist/handler.mjs`)
- `packages/shared` Zod schemas, constants, error codes
- `packages/crypto` client-side crypto (the API must never import it; enforced by lint)
- `packages/db` Drizzle schema and migrations (the web app must never import it)

## Rules

- Never commit secrets. The repo is public; a committed secret is a leaked secret. Rotate it.
- Secrets live in Vercel and GitHub Actions secrets only. `.env.example` lists names only.

License: MIT
