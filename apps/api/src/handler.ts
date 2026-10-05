// Bundled by esbuild into dist/handler.mjs and re-exported by /api/index.js on Vercel.
import { createDb, createPool, type Database } from '@sm/db'
import { createApp } from './app'
import type { Deps } from './deps'
import { parseEnv, type Env } from './env'

let env: Env | undefined
let db: Database | undefined

// Created on first use, once per warm function instance.
const deps: Deps = {
  getEnv: () => (env ??= parseEnv(process.env)),
  getDb: () => (db ??= createDb(createPool(deps.getEnv().DATABASE_URL))),
  now: () => new Date(),
}

export default createApp(deps)
