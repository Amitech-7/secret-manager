import { queryRows, sql, type Database } from '@sm/db'

export type SizeLevel = 'ok' | 'warn' | 'critical'

export interface MaintenanceResult {
  sessionsDeleted: number
  rateLimitsDeleted: number
  inactiveUsersDeleted: number
  dbSizeMb: number
  limitMb: number
  level: SizeLevel
}

const count = async (db: Database, query: ReturnType<typeof sql>): Promise<number> =>
  Number((await queryRows<{ n: number | string }>(db, query))[0]?.n ?? 0)

/** Housekeeping that keeps the free database small. Safe to run any number of times. */
export async function runMaintenance(
  db: Database,
  now: Date,
  limitMb: number,
): Promise<MaintenanceResult> {
  const sessionsDeleted = await count(
    db,
    sql`
    with d as (
      delete from sessions
      where expires_at < ${now}::timestamptz - interval '7 days'
         or revoked_at < ${now}::timestamptz - interval '7 days'
      returning 1)
    select count(*)::int as n from d`,
  )

  const rateLimitsDeleted = await count(
    db,
    sql`
    with d as (
      delete from rate_limits
      where window_start < ${now}::timestamptz - interval '1 day'
      returning 1)
    select count(*)::int as n from d`,
  )

  // Accounts that never stored anything and have not logged in for 90 days.
  const inactiveUsersDeleted = await count(
    db,
    sql`
    with d as (
      delete from users
      where item_count = 0
        and coalesce(last_login_at, created_at) < ${now}::timestamptz - interval '90 days'
      returning 1)
    select count(*)::int as n from d`,
  )

  const size = await queryRows<{ bytes: number | string }>(
    db,
    sql`select pg_database_size(current_database()) as bytes`,
  )
  const dbSizeMb = Number(size[0]?.bytes ?? 0) / (1024 * 1024)
  const ratio = dbSizeMb / limitMb
  const level: SizeLevel = ratio >= 0.9 ? 'critical' : ratio >= 0.7 ? 'warn' : 'ok'

  return {
    sessionsDeleted,
    rateLimitsDeleted,
    inactiveUsersDeleted,
    dbSizeMb: Math.round(dbSizeMb * 10) / 10,
    limitMb,
    level,
  }
}
