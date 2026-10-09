/** How long a copied secret stays on the clipboard before we try to clear it. */
export const CLIPBOARD_CLEAR_MS = 30_000

export interface ClipboardLike {
  writeText(text: string): Promise<void>
  readText?(): Promise<string>
}

let pending: ReturnType<typeof setTimeout> | undefined

/**
 * Copies `text`, then clears it after 30 seconds. If we are allowed to read the clipboard and it
 * now holds something else, we leave it alone. If reading is not allowed we clear anyway: losing
 * a clipboard is cheaper than leaving a password on it. Returns false if copying failed.
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
    void (async () => {
      try {
        const current = await clipboard.readText?.()
        if (current !== undefined && current !== text) return
      } catch {
        // Not allowed to read: fall through and clear.
      }
      try {
        await clipboard.writeText('')
      } catch {
        // Page not focused or permission lost: nothing more we can do.
      }
    })()
  }, CLIPBOARD_CLEAR_MS)
  return true
}
