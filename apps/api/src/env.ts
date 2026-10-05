import { z } from 'zod'

const secret = z.string().min(32, 'must be at least 32 characters')
const key32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be 32 bytes as base64url')

/**
 * Required now: DATABASE_URL, CRON_SECRET, RATE_LIMIT_SECRET.
 * The rest are optional until the milestone that uses them (auth, TOTP, captcha).
 */
const schema = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  CRON_SECRET: secret,
  RATE_LIMIT_SECRET: secret,
  JWT_SECRET: secret.optional(),
  TOTP_ENC_KEY: key32.optional(),
  FAKE_SALT_SECRET: secret.optional(),
  TURNSTILE_SECRET: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  DB_SIZE_LIMIT_MB: z.coerce.number().int().positive().default(512),
})

export type Env = z.infer<typeof schema>

/** Error text names the offending variables but never their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new Error(`Invalid environment: ${names.join(', ')}`)
  }
  return result.data
}
