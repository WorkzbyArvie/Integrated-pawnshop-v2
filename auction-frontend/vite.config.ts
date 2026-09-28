import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    allowedHosts: [
      '.up.railway.app',
    ],
  },
  server: {
    port: 5174,
    allowedHosts: [
      '.up.railway.app',
    ],
  },
  test: {
    environment: 'jsdom',
    // A concrete origin is required for `localStorage`/`sessionStorage` to
    // exist; an opaque origin would make the "no credential is persisted" (D-02)
    // assertions vacuously pass.
    environmentOptions: {
      jsdom: { url: 'http://localhost:5174/' },
    },
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
})
