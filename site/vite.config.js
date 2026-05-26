import { defineConfig } from 'vite'

export default defineConfig({
  // Base path is set at build time via VITE_BASE_URL env var.
  // GitHub Actions passes the repo name automatically.
  base: process.env.VITE_BASE_URL || '/',
})
