# Database and environments

One Neon project, two branches: `production` (root) and `development` (child). Each branch has
its own connection strings and its own roles. Nothing is shared except the free-tier allowance.

## Roles

| Role           | Used by                       | Can do                                        |
| -------------- | ----------------------------- | --------------------------------------------- |
| `neondb_owner` | the migration script, by hand | everything (create, alter, drop)              |
| `sm_app`       | the API at runtime            | read and write rows only. No DDL, no TRUNCATE |

The `sm_app` password must differ per branch. Connection strings live only in Vercel
environment variables and your password manager. Never in git, chat, or screenshots.

Two connection strings per branch:

- **Direct** (host has no `-pooler`), owner role: migrations only.
- **Pooled** (host contains `-pooler`), `sm_app` role: the API's `DATABASE_URL`.

## Migrations

Generated from `packages/db/src/schema.ts` and committed in `packages/db/migrations`:

```powershell
pnpm --filter @sm/db generate      # after changing schema.ts; review the SQL it writes
```

Applied by hand, one branch at a time, `development` first. CI never touches a database.

```powershell
pnpm --filter @sm/db migrate
```

The script asks for the owner's **direct** connection string (hidden input), prints the host,
database and role, and only proceeds if you type the endpoint id back. It refuses pooled hosts
and the `sm_app` role. It is safe to run twice: applied migrations are skipped.

Rules:

1. Test every migration on `development`, check the API on a Preview deployment, then run it on `production`.
2. Migrations only move forward. To undo something, write a new migration.
3. Never edit a migration that has already been applied anywhere.
4. Before a risky production migration, export what matters. Neon's free history window is short.

## Environment variables

Set in Vercel, Project Settings, Environment Variables. Mark secrets as Sensitive.

| Variable                       | Production                            | Preview                                |
| ------------------------------ | ------------------------------------- | -------------------------------------- |
| `DATABASE_URL`                 | `production` branch, `sm_app`, pooled | `development` branch, `sm_app`, pooled |
| `CRON_SECRET`                  | 32+ random characters                 | a different random value               |
| `RATE_LIMIT_SECRET`            | 32+ random characters                 | a different random value               |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`                                   | `1`                                    |

Later milestones add `JWT_SECRET`, `FAKE_SALT_SECRET`, `TOTP_ENC_KEY`, `TURNSTILE_SECRET` and
`ALLOWED_ORIGINS` (see `.env.example`). Redeploy after changing variables.

Generate a random value in PowerShell (works in Windows PowerShell and PowerShell 7):

```powershell
$b = New-Object byte[] 48
$rng = [Security.Cryptography.RNGCryptoServiceProvider]::new(); $rng.GetBytes($b)
([Convert]::ToBase64String($b)) -replace '[+/=]', ''
```

## Maintenance job

`GET /api/v1/cron/maintenance` runs daily from Vercel Cron (production only). It deletes expired
sessions, old rate-limit rows and accounts that stored nothing and have not logged in for 90
days, then reports database size. At 70% of `DB_SIZE_LIMIT_MB` (default 512) it logs a
warning, at 90% a critical warning. There is no email service, so the Vercel runtime logs are
the alert: check them now and then.

## Quotas

1,000 items per user, 8 KB per item (enforced in the API and by database CHECK constraints).
