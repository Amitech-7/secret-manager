import { defineConfig } from 'vitest/config'

// Several tests run the real Argon2id and a real in-process Postgres.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } })
