# Security headers and the Content Security Policy

All headers are set in `vercel.json` for every path. Tests pin them down (`apps/web/src/csp.test.ts`)
and the browser suite checks that a full journey causes **zero** policy violations.

## What each header does

| Header                                                                                     | Purpose                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` (enforced)                                                       | `frame-ancestors 'none'` (nobody can embed the app, stops clickjacking), `base-uri 'none'`, `object-src 'none'`, `form-action 'none'`, `upgrade-insecure-requests`. These cannot break the app, so they are enforced now. |
| `Content-Security-Policy-Report-Only`                                                      | The full policy: deny everything, then allow only own files, WebAssembly (for Argon2id), and Cloudflare Turnstile. **Reported, not yet enforced.**                                                                        |
| `Strict-Transport-Security`                                                                | Browsers use HTTPS only for two years. No `preload`, which is hard to undo.                                                                                                                                               |
| `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` | Older equivalents and basic hygiene.                                                                                                                                                                                      |
| `Permissions-Policy`                                                                       | Switches off camera, microphone, location, payment, USB and similar. The clipboard is left alone because the Copy buttons need it.                                                                                        |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy: same-origin`                  | Isolates the app from other sites' windows and stops them embedding its files.                                                                                                                                            |

The API adds `Cache-Control: no-store` to every response, so ciphertext and sessions are never cached.

## The full policy

```
default-src 'none'
script-src  'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com
frame-src   https://challenges.cloudflare.com
style-src 'self'   img-src 'self'   font-src 'self'   connect-src 'self'
worker-src 'self'  manifest-src 'self'
```

- `'wasm-unsafe-eval'` is needed because Argon2id is WebAssembly. It does **not** allow `eval`.
- Cloudflare documents `script-src` and `frame-src` for `challenges.cloudflare.com` as the only
  requirements for Turnstile (checked October 2026). `connect-src` is only needed for its
  pre-clearance mode, which this app does not use.
- Styles set from code (the colour swatches, the theme) use the browser's style API, which the
  policy allows. There is no inline `<style>` and no inline script anywhere.

## Rolling it out (do this once)

1. Deploy. The full policy is in **report-only** mode: nothing can break, and the browser console
   lists anything it would have blocked.
2. On the Preview deployment, with DevTools open on the **Console**, go through register, log in,
   the vault, backup export and import, and the forgot-password flow, using the **real**
   Turnstile widget. Look for lines starting `[Report Only] Refused to ...`.
3. Zero lines: switch to enforcing. If Turnstile or anything else is listed, add the origin it
   names to the right directive in `vercel.json`, run `pnpm test`, and repeat step 2.
4. To enforce, in `vercel.json` rename the key `Content-Security-Policy-Report-Only` to
   `Content-Security-Policy` and delete the old, smaller `Content-Security-Policy` entry. The full
   policy does not contain `frame-ancestors` or `upgrade-insecure-requests` (browsers ignore them
   in report-only mode), so **keep both** by adding `frame-ancestors 'none'; upgrade-insecure-requests`
   to the end of the full policy when you merge them. `csp.test.ts` fails if the result is unsafe.
5. Redeploy, repeat the walkthrough once on Preview, then on production.

If enforcement ever locks you out (for example Turnstile changes its origins), revert the key
name to `Content-Security-Policy-Report-Only` and redeploy.

## Notes

- Vercel's Preview toolbar adds its own scripts for signed-in team members and will show up in
  the console as violations. Ignore those, or turn the toolbar off in the project settings.
- There is no report-collection endpoint on purpose (it would be a public, unauthenticated
  route). Reports are visible only in your own browser's console.
- The browser tests (`pnpm e2e`) already enforce the **full** policy against the production
  build, so a pass there means flipping the switch is safe for everything except the real
  Cloudflare widget, which can only be checked by hand.
