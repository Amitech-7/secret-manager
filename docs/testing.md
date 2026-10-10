# Testing

## Everyday checks

```powershell
pnpm lint
pnpm typecheck
pnpm test        # unit and integration tests (fast, no browser)
```

## Browser tests (Playwright)

`pnpm e2e` drives the real web app in a real browser at **360 px wide** (a small phone) against
the real API and the production database migrations, on a throwaway in-memory Postgres. It
never touches Neon. The captcha script is replaced by a stub that passes.

It builds the web app and serves the **production build with the exact headers from
`vercel.json`**, with the Content Security Policy enforced. The final test fails if anything in
the whole journey (page, key-derivation worker, frames) breaks the policy. Set `E2E_DEV=1` to
use the quicker Vite dev server instead; that skips the header check.

First time only:

```powershell
pnpm install
pnpm --filter @sm/e2e exec playwright install chromium
```

Then:

```powershell
pnpm e2e                                   # headless
pnpm --filter @sm/e2e e2e:headed           # watch it run
$env:E2E_SCREENSHOTS = "shots"; pnpm e2e   # also save a picture of each screen
```

The suite is one person's journey, in order: register and save the recovery key, add a
credential with the generator (show, copy), add a card, validation messages, manage lists
(including blocked deletes), edit, back up to a file, delete, restore from the file, reload
(locks the vault), log in again, account menu and logout, and automatic logout after
inactivity. Every screen is also checked for sideways scrolling, and the journey must cause no
Content Security Policy violations.

It does **not** replace the manual checklist in `manual-test.md`: real Cloudflare Turnstile, the
real Neon database, other browsers and real phones need a human.

### Continuous integration

Add a job next to the existing ones (it is deliberately not part of `pnpm test`):

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @sm/e2e exec playwright install --with-deps chromium
    - run: pnpm e2e
    - uses: actions/upload-artifact@v4
      if: failure()
      with: { name: playwright-traces, path: apps/e2e/test-results }
```

### Locked-down machines

If Playwright cannot download a browser, point it at one you already have:
`E2E_CHROMIUM_PATH=/path/to/chrome`. That also switches on the flags containers usually need.
