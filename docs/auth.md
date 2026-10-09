# Accounts, sessions and the captcha

## What the server stores for each user

- `auth_hash`: SHA-256 of the key the browser derives from the master password. The password,
  that key and the vault key are never stored. A database thief can still try password guesses
  offline against `wrapped_vk_pw`, at full Argon2id cost, which is why the password strength
  rule exists.
- `wrapped_vk_pw` / `wrapped_vk_rec`: the vault key encrypted under the password-derived key and
  under the recovery key.
- `vault_items`: ciphertext only.

## Registration order

1. The browser derives keys, generates the vault key and recovery key, and encrypts the seed items.
2. It shows the recovery key. The person must tick "I saved it" and retype the last five characters.
3. Only then does it solve the captcha and call `POST /auth/register`.

A person therefore never ends up with an account but no recovery key.

## Sessions

- Access token: HS256 JWT, 15 minutes. Every request also checks the session row, so logout and
  refresh-reuse revocation take effect immediately.
- Refresh token: random, stored only as a hash, rotated on every use, 30 days absolute, at most
  10 sessions per user. Presenting an already-rotated token revokes the whole session.
- The web app keeps tokens and the vault key in memory only. Closing or reloading the tab locks
  the vault.

## Password change, recovery and deletion

- **Change password** (signed in): re-enter the current password and pick a new one. The browser
  derives new keys with a fresh salt and the current default Argon2id settings and re-wraps the
  vault key; no item is re-encrypted. Every other session is signed out; this one stays.
- **Forgot password:** username + recovery key + new password. The browser proves it holds the
  recovery key (`/auth/recover/begin`), then shows a **replacement recovery key** that must be saved
  before anything changes (`/auth/recover/complete`). Recovery signs out every session, turns
  two-factor off, and signs the person in fresh. The step-1 proof lasts 10 minutes and works once.
- **Replace recovery key** (signed in): needs the master password, because that is how the vault
  key is re-wrapped. The old key keeps working until the new one is saved and submitted.
- **Delete account:** needs the master password; removes the user, all items and all sessions.

A wrong password on any of these is rejected locally when the old wrapping will not open, and by the
server comparing the derived key. Wrong attempts count toward the limits below.

## Rate limits (per window)

| Endpoint                        | Limit                                                    |
| ------------------------------- | -------------------------------------------------------- |
| `/auth/salt`                    | 10 per minute per IP                                     |
| `/auth/login`                   | 10 per minute per IP, and 10 per 15 minutes per username |
| `/auth/register`                | 3 per hour per IP                                        |
| `/auth/refresh`, `/auth/logout` | 30 per minute per IP                                     |
| `/me`                           | 60 per minute per IP                                     |
| `/vault/items`                  | 300 per minute per IP, and 120 per minute per user       |

The per-username login limit counts every attempt, right or wrong, and for names that do not
exist. A stranger can use it to lock someone out for up to 15 minutes. That is an accepted trade
for now.

## Cloudflare Turnstile

1. Create a free Cloudflare account and open **Turnstile**, then **Add widget**.
2. Hostname: `secret-manager-ten.vercel.app` (add others later). Widget mode: Managed.
3. Copy the **Site key** (public) into `VITE_TURNSTILE_SITE_KEY` and the **Secret key** into
   `TURNSTILE_SECRET`, both for **Production** only.
4. For **Preview**, use Cloudflare's published always-pass test keys instead. They work on any
   hostname. Confirm the current values on Cloudflare's "Testing" page.
5. Redeploy. Registration is refused (fail closed) whenever `TURNSTILE_SECRET` is missing.

## Content Security Policy (M9)

When the CSP is added, it must allow `https://challenges.cloudflare.com` for scripts and frames,
and `'wasm-unsafe-eval'` for Argon2id (WebAssembly).
