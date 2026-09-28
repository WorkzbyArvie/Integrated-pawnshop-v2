/* global process */
import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import tailwindcss from "@tailwindcss/vite" // Since you are on v4
import { assertValidViteEnv } from "./env-guard.js"

/**
 * Fails the production build when the frontend environment is unusable.
 *
 * A mistyped Supabase project reference is well formed but points at a project
 * that does not exist, so it used to reach the browser and surface as a DNS
 * error during sign-in with nothing tying it to the cause.
 *
 * Values are read through Vite's own loader so a local `.env` counts the same
 * way the deployment platform's variables do; `process.env` alone would miss
 * every file-based value and break local builds.
 */
function envGuard() {
  return {
    name: "pawngold-env-guard",
    apply: "build",
    config(_config, env) {
      const fileValues = loadEnv(env.mode, process.cwd(), "VITE_")
      assertValidViteEnv({ ...fileValues, ...process.env })
    },
  }
}

export default defineConfig({
  plugins: [envGuard(), react(), tailwindcss()],
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
    allowedHosts: [
      ".up.railway.app",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          vendor: ["@supabase/supabase-js", "sweetalert2"],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // A concrete origin is required for `localStorage`/`sessionStorage` to
    // exist; an opaque origin would make the "no credential is persisted" (D-02)
    // assertions vacuously pass.
    environmentOptions: {
      jsdom: { url: 'http://localhost:5173/' },
    },
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
  server: {
    allowedHosts: [
      ".up.railway.app",
    ],
    proxy: {
      '/analytics': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/queue': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/finance': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/attendance': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/payroll': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/notifications': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/subscriptions': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  }
})