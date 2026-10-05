import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from './errors'

/** Parses a JSON body against a Zod schema. Failures surface as a 400 VALIDATION error. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new AppError('VALIDATION', 'Request body must be valid JSON')
  }
  return schema.parse(raw)
}
