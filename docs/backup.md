# Backup: export and import

## What the file is

An encrypted `.smvault` file saved on the device. It holds every item the browser can read: your
credentials and cards plus the members, banks, account types and accounts they use. It is
locked with a **backup passphrase** you choose when exporting (at least 12 characters), using
Argon2id and AES-256-GCM. The file is never uploaded; the browser builds it and hands it to the
download flow.

- The passphrase is separate from the master password, so a backup still opens after the master
  password changes.
- Nobody can recover a lost backup passphrase, including us.
- The header (format, version, key settings, salt) is authenticated, so editing it makes the file
  fail to open. The file reveals only that it is a Secret Manager backup and roughly how large it is.
- Items this device could not decrypt are counted and left out, and the screen says so.

## Importing

Choosing a file and entering the passphrase shows a **summary before anything changes**: what
would be added, what is already in the vault, what differs, and what in the file cannot be used
(with the reason, never the content).

How items are matched:

1. By id, then by content: a credential by member + account + username, a card by member + bank +
   card number. Importing the same file twice changes nothing.
2. Members, banks, account types and accounts are matched by name when their ids differ, so a
   backup from another account merges into the starter lists instead of duplicating them.
   Credentials and cards are re-pointed at the matching entries.
3. Anything new gets a fresh id, so a file can never collide with another account's data.

Items that exist but differ from the file are kept as they are unless you pick **Replace with the
backup's version**.

Items are written in chunks of 50 (members, banks and so on first). An interrupted import can be
run again safely: it only adds what is still missing. Nothing is added if the result would pass
the 1,000 item limit, and a file may hold at most 5,000 items.

## Limits worth knowing

- The import trusts nothing in the file: every item is checked against the same rules as the forms.
- The backup contains your secrets in the clear once decrypted on screen, so only import files you
  made yourself.
- Cards are matched by number, so a card whose number you changed in the vault shows up as new.
