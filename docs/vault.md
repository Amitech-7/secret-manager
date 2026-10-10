# Using the vault

## Layout

The round button at the top right (your initial) opens the account menu: **My vault**, **Backup**,
**Settings and password**, **Theme** and **Log out**. Before you log in the header shows only the
Theme control. Documentation and Contact Us are in the footer.

## Dashboard

- Pick a **Member** (Self is the default), then **Credentials** or **Cards**.
- Credentials filter by **Account type** and **Account**; cards filter by **Bank**.
- Passwords, card numbers and CVVs are hidden. **Show** reveals a value for 15 seconds. **Copy**
  puts it on the clipboard and clears the clipboard 30 seconds later (anything else you copied in
  that window is cleared too, because reading the clipboard would trigger a browser permission
  prompt). Card numbers display as
  `xxxx xxxx xxxx 0123`.
- **Manage lists** adds, renames and deletes members, banks, account types and accounts. Anything
  still used by a credential or card cannot be deleted, and at least one member must remain.
- Deleting an item is permanent and instant: you must type its name first.

## Password generator

Under the password field of a credential, **Generate a strong password** makes a random password
in the browser (length 8 to 64; lowercase, uppercase, numbers, symbols; optional "avoid look-alike
characters"). It always includes at least one character of each chosen kind. Nothing is stored or
sent. Choosing **Use this password** fills the field and shows it so you can check it.

## Automatic log out

After 5 minutes without a key press, tap or scroll, or 1 minute after the tab goes to the
background, you are logged out. Because the vault key exists only in memory, this locks the
vault immediately; logging in again takes a few seconds for the key derivation.
