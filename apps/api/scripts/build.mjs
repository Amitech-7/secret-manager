// Bundles the API into one file so Vercel needs no node_modules tracing. Using esbuild's JS API
// instead of CLI flags keeps quoting identical on Windows, macOS and Linux.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/handler.ts'],
  outfile: 'dist/handler.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Optional native driver that pg probes for; we use the pure-JS path.
  external: ['pg-native'],
  // Some bundled dependencies are CommonJS and call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
})
