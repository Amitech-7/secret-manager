import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // bench.html is a temporary tool for choosing Argon2id parameters. Remove it after M1.
    rollupOptions: { input: { main: 'index.html', bench: 'bench.html' } },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { environment: 'node' },
})
