import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { secureConnectionString } from '../src/connection'

/**
 * Applies migrations to ONE database, deliberately and by hand. CI never runs this.
 *
 * Use the OWNER role's DIRECT connection string (host without "-pooler"). The string is read
 * from MIGRATION_DATABASE_URL or from a hidden prompt, and is never printed or stored.
 */
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(question)
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buffer = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(buffer.trim())
          return
        }
        if (ch === '\u0003') process.exit(130)
        if (ch === '\u007f' || ch === '\b') buffer = buffer.slice(0, -1)
        else buffer += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const url =
    process.env.MIGRATION_DATABASE_URL ?? (await promptHidden('Owner connection string (hidden): '))
  if (!url) throw new Error('No connection string provided')

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('That is not a valid connection string')
  }
  const host = parsed.hostname
  const endpoint = host.split('.')[0] ?? host
  const database = parsed.pathname.replace(/^\//, '')
  const role = decodeURIComponent(parsed.username)

  console.log('\nTarget')
  console.log(`  host:     ${host}`)
  console.log(`  database: ${database}`)
  console.log(`  role:     ${role}`)
  if (host.includes('-pooler')) {
    console.error(
      '\nRefusing: this is a pooled host. Use the direct connection string for migrations.',
    )
    process.exit(1)
  }
  if (role === 'sm_app') {
    console.error('\nRefusing: sm_app is the restricted runtime role. Use the owner role.')
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`\nType the endpoint id "${endpoint}" to apply migrations: `)
  rl.close()
  if (answer.trim() !== endpoint) {
    console.error('Not confirmed. Nothing was changed.')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString: secureConnectionString(url), max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder })
    console.log('\nMigrations applied.')
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  // Never print the error object itself: driver errors can echo connection details.
  console.error('Migration failed:', err instanceof Error ? err.message.split('\n')[0] : 'unknown')
  process.exit(1)
})
