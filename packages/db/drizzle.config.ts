import { defineConfig } from 'drizzle-kit'

// `generate` only reads the schema and writes SQL files. It never connects to a database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
})
