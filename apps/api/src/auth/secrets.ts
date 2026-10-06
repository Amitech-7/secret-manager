import { AppError } from '../errors'

/** A feature secret that is optional in the env schema but needed by the route being served. */
export function requireSecret(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`${name} is not configured`)
    throw new AppError('INTERNAL', 'Internal error')
  }
  return value
}
