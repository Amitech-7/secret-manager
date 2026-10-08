import {
  AUTH_LIMITS,
  ITEM_TYPES,
  KDF_BOUNDS,
  LIMITS,
  USERNAME_PATTERN,
  WIRE_BYTES,
} from '@sm/shared'
import { z } from 'zod'

/** Canonical unpadded base64url that decodes to exactly `bytes` bytes. */
const fixedBytes = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((s) => {
      const raw = Buffer.from(s, 'base64url')
      return raw.length === bytes && raw.toString('base64url') === s
    }, `must be ${bytes} bytes`)

const boundedBytes = (min: number, max: number, firstByte?: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((s) => {
      const raw = Buffer.from(s, 'base64url')
      if (raw.length < min || raw.length > max || raw.toString('base64url') !== s) return false
      return firstByte === undefined || raw[0] === firstByte
    }, `must be ${min}-${max} bytes`)

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin)
  .max(LIMITS.usernameMax)
  .regex(USERNAME_PATTERN)

export const kdfParamsSchema = z
  .object({
    alg: z.literal('argon2id'),
    version: z.literal(19),
    memoryKiB: z.number().int().min(KDF_BOUNDS.minMemoryKiB).max(KDF_BOUNDS.maxMemoryKiB),
    iterations: z.number().int().min(KDF_BOUNDS.minIterations).max(KDF_BOUNDS.maxIterations),
    parallelism: z.number().int().min(KDF_BOUNDS.minParallelism).max(KDF_BOUNDS.maxParallelism),
  })
  .strict()

/** An AES-GCM envelope: version byte 1, then IV, ciphertext and tag. Contents stay opaque. */
export const ciphertextSchema = boundedBytes(WIRE_BYTES.minCiphertext, LIMITS.maxItemBytes, 1)

export const seedItemSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(ITEM_TYPES),
    ciphertext: ciphertextSchema,
  })
  .strict()

export const saltRequestSchema = z.object({ username: usernameSchema }).strict()

export const registerSchema = z
  .object({
    username: usernameSchema,
    authKey: fixedBytes(WIRE_BYTES.authKey),
    kdfSalt: fixedBytes(WIRE_BYTES.kdfSalt),
    kdfParams: kdfParamsSchema,
    wrappedVkPw: fixedBytes(WIRE_BYTES.wrappedVaultKey),
    wrappedVkRec: fixedBytes(WIRE_BYTES.wrappedVaultKey),
    recoveryAuth: fixedBytes(WIRE_BYTES.recoveryAuth),
    profileEnc: boundedBytes(WIRE_BYTES.minCiphertext, AUTH_LIMITS.maxProfileBytes, 1).optional(),
    seedItems: z
      .array(seedItemSchema)
      .max(AUTH_LIMITS.maxSeedItems)
      .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'duplicate ids'),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict()

export const loginSchema = z
  .object({ username: usernameSchema, authKey: fixedBytes(WIRE_BYTES.authKey) })
  .strict()

export const refreshSchema = z
  .object({ refreshToken: fixedBytes(WIRE_BYTES.refreshToken) })
  .strict()

const newCredentials = {
  newAuthKey: fixedBytes(WIRE_BYTES.authKey),
  newKdfSalt: fixedBytes(WIRE_BYTES.kdfSalt),
  newKdfParams: kdfParamsSchema,
  newWrappedVkPw: fixedBytes(WIRE_BYTES.wrappedVaultKey),
}

export const passwordChangeSchema = z
  .object({ currentAuthKey: fixedBytes(WIRE_BYTES.authKey), ...newCredentials })
  .strict()

export const recoveryRotateSchema = z
  .object({
    currentAuthKey: fixedBytes(WIRE_BYTES.authKey),
    newWrappedVkRec: fixedBytes(WIRE_BYTES.wrappedVaultKey),
    newRecoveryAuth: fixedBytes(WIRE_BYTES.recoveryAuth),
  })
  .strict()

export const recoverBeginSchema = z
  .object({ username: usernameSchema, recoveryAuth: fixedBytes(WIRE_BYTES.recoveryAuth) })
  .strict()

export const recoverCompleteSchema = z
  .object({
    recoveryToken: z.string().min(20).max(1024),
    ...newCredentials,
    newWrappedVkRec: fixedBytes(WIRE_BYTES.wrappedVaultKey),
    newRecoveryAuth: fixedBytes(WIRE_BYTES.recoveryAuth),
  })
  .strict()

export const deleteAccountSchema = z.object({ authKey: fixedBytes(WIRE_BYTES.authKey) }).strict()
