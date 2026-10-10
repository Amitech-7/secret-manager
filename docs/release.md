# Release checklist

Work through this top to bottom for every release. Stop at the first failure.

## 1. Before merging

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm e2e` (production build with the real security headers; expects `12 passed`)
- [ ] `pnpm audit:prod` reports no known vulnerabilities
- [ ] `pnpm --filter @sm/db generate` writes no new migration (the schema matches the migrations)
- [ ] gitleaks is clean (the commit hook runs it)

## 2. Database

- [ ] Any new migration is applied to the `development` branch first
      (`pnpm --filter @sm/db migrate`, owner direct connection, endpoint id confirmed)
- [ ] Environment variables are set for Preview and Production, secrets marked Sensitive and
      different per environment (list in `database.md`)

## 3. Preview deployment

- [ ] `/api/v1/health` is `ok` and the footer says "Server: ok"
- [ ] The starred items in `manual-test.md`
- [ ] Console check for the policy (see `security-headers.md`): no `[Report Only]` lines while
      registering with the real Turnstile widget, logging in, using the vault, and backing up

## 4. Production

- [ ] Take an export of anything that matters (Neon's free history window is short)
- [ ] Apply new migrations to `production`
- [ ] Merge to main and wait for the deployment
- [ ] Re-run the starred items in `manual-test.md` on the production URL
- [ ] Vercel logs show no errors, and the next daily maintenance run completes

## 5. If something is wrong

- Bad deployment: promote the previous one from the Vercel dashboard.
- Policy problem: put the key back to `Content-Security-Policy-Report-Only` and redeploy.
- Migrations only move forward: undo with a new migration, never by editing an old one.
