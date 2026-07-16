/* global process */
import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite" // Since you are on v4

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
          vendor: ["@supabase/supabase-js", "axios", "sweetalert2"],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
  server: {
    allowedHosts: [
      ".up.railway.app",
    ],
    proxy: {
      '/analytics': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/queue': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/finance': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/attendance': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/payroll': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/compliance': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/notifications': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      },
      '/subscriptions': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        secure: false
      }
    }
  }
})