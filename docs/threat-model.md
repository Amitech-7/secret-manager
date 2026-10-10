# Threat model

What this app protects, what an attacker could and could not do, and what it does not defend
against. It has **not** been independently audited.

## What is protected

The contents of your vault (credentials and cards), your master password, your recovery key and
the vault key. All encryption happens in the browser. The server stores ciphertext and never
receives any of these.

## Who has to be trusted

| Party                             | Trusted with                                       | Not trusted with                          |
| --------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| Your browser and device           | Everything in plain text while you use the app     |                                           |
| The code served to your browser   | Everything (see "Malicious server" below)          |                                           |
| Neon (database), Vercel (hosting) | Availability                                       | Plaintext: they only ever hold ciphertext |
| Cloudflare Turnstile              | Running a script on the pages that use the captcha | Your vault                                |

## Scenarios

**Someone steals the database.** They get usernames, ciphertext, wrapped vault keys, salts and
Argon2id settings, plus metadata (item kinds, counts, sizes, timestamps). They cannot read items.
Their only attack is guessing your master password offline against the wrapped vault key, at full
Argon2id cost (108 MiB of memory per guess by default). That is why registration enforces a strong
password. A weak password is the weak point; the recovery key is random and not guessable.

**The server, or the hosting account, is compromised or malicious.** This is the hard limit of any
web app that encrypts in the browser: it could serve changed JavaScript that captures your master
password the next time you log in. The Content Security Policy, exact dependency versions and
keeping the only third-party script to Cloudflare Turnstile reduce the chance and the blast
radius, but cannot remove it. A malicious server can also:

- withhold, hide or delete items (you would see fewer items);
- send back an older but valid copy of an item or of the whole vault (not detected: items are
  bound to their id and kind, but not to a version number or a global state);
- not swap ciphertext between items or accounts: that fails decryption and is shown as
  "could not be opened".

**A network attacker.** HTTPS everywhere, HSTS, and tokens sent in a header (there are no cookies,
so no cross-site request forgery).

**Script injection (XSS).** React escapes everything it renders; there is no raw HTML anywhere and
user text is always shown as text. The Content Security Policy forbids inline scripts, `eval` and
any script origin except our own files and Turnstile. If injection did succeed it could read the
in-memory vault key, which is why the policy matters.

**Turnstile.** On the pages that include the captcha, Cloudflare's script runs with the page's
privileges. Cloudflare could in principle read what is typed there. Accepted trade-off for
bot protection on registration.

**Someone gets your unlocked device or has malware on it.** Out of scope: a keylogger or a
browser extension that can read pages sees everything you see. Mitigations: the vault key is kept
only in memory and lost on reload, automatic logout after 5 idle minutes or 1 minute in the
background, values hidden until shown (15 seconds), and the clipboard cleared after 30 seconds
(best effort: browsers can refuse, and anything else you copied in that window is cleared too).

**A backup file is stolen.** It is protected only by your backup passphrase. The only rule is
12 characters, with no strength estimate, so choose a long random one. Guessing costs the same
Argon2id work as the master password.

**Forgotten master password.** Cannot be reset by design. The recovery key is the only fallback;
losing both loses the vault.

**Guessing and lock-out.** Login is limited per IP and per username. The per-username limit lets a
stranger lock someone out for up to 15 minutes. Accepted for now.

**Dependencies.** Runtime packages are pinned to exact versions, installs use a frozen lockfile,
`pnpm audit --prod` is clean, and secrets are scanned for before every commit.

## What the server can see

Usernames, IP addresses (rate limiting), when you log in, how many items you have, their kind
(credential, card, member, bank, account type, account), their encrypted size and when they
changed. Not their content, names, or how they relate to each other.

## Known gaps

- No independent security audit.
- Item kinds are visible to the server.
- Older-version replay of items or the whole vault is not detected.
- The backup passphrase has no strength meter.
- No list of active sessions, no way to rotate the vault key, and no second factor in the UI yet
  (the server side exists).
- Argon2id at 108 MiB may be slow on low-end phones.
