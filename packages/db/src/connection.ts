/**
 * Remote databases are always reached over TLS with full certificate verification.
 *
 * Today node-postgres treats sslmode=require as verify-full, but its next major version will
 * switch to libpq semantics, where "require" encrypts without checking the certificate and
 * would silently allow a man-in-the-middle. Pinning verify-full here makes that upgrade safe,
 * and also silences the deprecation warning. Only loopback hosts are left untouched, so local
 * and test databases without TLS keep working.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function secureConnectionString(raw: string): string {
  const url = new URL(raw)
  if (LOOPBACK.has(url.hostname)) return raw
  url.searchParams.set('sslmode', 'verify-full')
  url.searchParams.delete('uselibpqcompat')
  return url.toString()
}
