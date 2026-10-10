/** Hands a text file to the browser's download flow. Nothing is uploaded anywhere. */
export function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Backups are far smaller than this; the limit just stops a huge file freezing the page. */
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024

export async function readBackupFile(file: File): Promise<string> {
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new RangeError('FILE_TOO_LARGE')
  return file.text()
}
