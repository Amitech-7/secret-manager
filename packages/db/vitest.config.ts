import { defineConfig } from 'vitest/config'

// Some suites start an in-process Postgres or run the real Argon2id. On a busy machine (or a small
// CI runner) that can take longer than the 10 second default, so the limits here are generous.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } })
