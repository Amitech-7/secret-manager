# Manual test checklist

Automated tests cover the logic and one full journey (see `testing.md`). These checks need a
human, a real device, or a real service. Run them on a **Preview** deployment (development
database, test captcha) before promoting to production, and the starred ones again on
production after release.

## Before you start

- [ ] Migrations are applied to the `development` branch (`pnpm --filter @sm/db migrate`), then,
      after the Preview check, to `production`. The newest is `0002_vault_items_cleanup`.
- [ ] `/api/v1/health` shows `ok` and the footer shows "Server: ok".

## Accounts and sign-in

- [ ] Register with the **real** Turnstile widget (production keys) ★. The captcha appears and
      "Create account" stays disabled until it passes.
- [ ] The recovery key must be ticked and its last five characters retyped before continuing.
- [ ] Log out, log in. Wrong password shows a clear message. Ten quick wrong attempts are limited.
- [ ] Forgot password with the recovery key works, shows a **new** recovery key, and signs out
      other sessions.
- [ ] Change password, then log in with the new one only.

## Vault

- [ ] Add, edit and delete a credential and a card. Deleting needs the name typed.
- [ ] Passwords, card numbers and CVVs are hidden; Show hides again after about 15 seconds.
- [ ] Copy works, and the clipboard is empty about 30 seconds later ★. No browser permission
      prompt ever appears. (Anything else you copy in those 30 seconds is cleared too.)
- [ ] Filters: Member, then Account type and Account (credentials) or Bank (cards).
- [ ] Manage lists: a member, bank, account or account type that is still used cannot be
      deleted; the last member cannot be deleted; duplicate names are refused.
- [ ] Password generator: length slider, each kind off and on, look-alike option; at least one
      kind is always required.
- [ ] Two browsers on one account: edit the same item in both; the second save says it was
      changed on another device and Reload fixes it.

## Backup

- [ ] Export, then open the file in a text editor: nothing readable inside ★.
- [ ] Import into a **second, new** account: starter lists merge, nothing is duplicated.
- [ ] Import the same file again: nothing is added.
- [ ] Wrong passphrase and a renamed or edited file give clear errors.
- [ ] On a phone (iOS Safari and Android Chrome): the file downloads and can be chosen again for
      import ★.
- [ ] With a vault near 1,000 items, an import that would pass the limit is refused with no
      partial result.

## Security headers ★

Open DevTools on the **Console** first. See `security-headers.md` for how to read the result.

- [ ] Registering with the **real** Turnstile widget logs no `[Report Only] Refused to ...`
      lines. If it does, note the directive and origin it names.
- [ ] The same is true for login, the vault, Manage lists, Backup (export and import), Settings,
      and forgot-password.
- [ ] Response headers on the home page (DevTools, Network, the document) include
      `Content-Security-Policy`, `Content-Security-Policy-Report-Only`, `Strict-Transport-Security`,
      `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- [ ] An API response (for example `/api/v1/health`) shows `Cache-Control: no-store`.
- [ ] Try framing the site from another page: it must refuse to load.

## Inactivity and sessions

- [ ] Leave the app untouched for 5 minutes: logged out with a message.
- [ ] Switch to another app on a phone for over a minute and return: logged out.
- [ ] Reloading the page asks for the password again (the vault never stays unlocked).

## Look and feel

- [ ] Every screen at **360 px** wide: no sideways scrolling, buttons easy to tap.
- [ ] Light, Dark, Night and System modes, and a custom accent: text stays readable on each
      screen, including the account menu and the delete confirmation.
- [ ] Rotate a phone and use landscape.
- [ ] Zoom to 200%: still usable.
- [ ] Keyboard only: Tab reaches everything, the account menu closes with Escape, focus is visible.
- [ ] Screen reader (VoiceOver or TalkBack): the account button, Show/Copy buttons and error
      messages are announced sensibly.

## Production only ★

- [ ] The Vercel logs show no errors after the checks above.
- [ ] The daily maintenance run (Vercel Cron) completes; the database-size line appears.
- [ ] A vault with 300 maximum-size items (about 2.4 MB of data) still loads: the list is paged,
      so no response should exceed the 4.5 MB function limit.
