import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The zxcvbn password dictionary (about 1.2 MB, 613 KB gzipped) is a lazy chunk loaded only
    // on the register page. The limit is set just above it so any other large chunk still warns.
    chunkSizeWarningLimit: 1300,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { environment: 'node' },
})
