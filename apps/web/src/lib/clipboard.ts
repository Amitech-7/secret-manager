/** How long a copied secret stays on the clipboard before we clear it. */
export const CLIPBOARD_CLEAR_MS = 30_000

export interface ClipboardLike {
  writeText(text: string): Promise<void>
}

let pending: ReturnType<typeof setTimeout> | undefined

/**
 * Copies `text`, then overwrites the clipboard with nothing after 30 seconds. We deliberately do
 * not read the clipboard first to see whether it still holds the secret: browsers ask the person
 * for permission to read it, and a prompt appearing half a minute after a copy is confusing in a
 * password manager. The cost is that anything the person copies elsewhere within those 30
 * seconds is cleared too. Returns false if copying failed.
 */
export async function copySecret(
  text: string,
  clipboard: ClipboardLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard) return false
  try {
    await clipboard.writeText(text)
  } catch {
    return false
  }
  clearTimeout(pending)
  pending = setTimeout(() => {
    // Page not focused or permission lost: nothing more we can do, and nothing to report.
    void clipboard.writeText('').catch(() => undefined)
  }, CLIPBOARD_CLEAR_MS)
  return true
}
