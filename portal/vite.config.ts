/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built portal works from any folder (e.g. a future /portal/ path) without a server rewrite
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
