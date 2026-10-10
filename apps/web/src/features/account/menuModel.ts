export type Screen = 'vault' | 'backup' | 'settings'

export const MENU_SCREENS: ReadonlyArray<{ screen: Screen; label: string }> = [
  { screen: 'vault', label: 'My vault' },
  { screen: 'backup', label: 'Backup (export and import)' },
  { screen: 'settings', label: 'Settings and password' },
]

/** The letter shown on the account button. Never more than one character. */
export function initialOf(username: string): string {
  const first = [...username.trim()][0]
  return first ? first.toUpperCase() : '?'
}
