/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

// The existing learning engine (the published site folders, unchanged) is served by the portal at /play/…,
// so it runs on the portal's own origin and the portal can listen to its progress without changing it.
const SITE = resolve(import.meta.dirname, '..')
const PLAY_DIRS = ['math', 'english', 'fractions', 'icons']
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' }

function enginePlayer(): Plugin {
  return {
    name: 'masa-engine-player',
    configureServer(server) {
      server.middlewares.use('/play', (req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^\/+/, '')
        const top = path.split('/')[0]
        if (!PLAY_DIRS.includes(top)) return next()
        let file = join(SITE, path)
        if (!file.startsWith(SITE + '/')) return next()                       // no path tricks outside the site
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const d of PLAY_DIRS) if (existsSync(join(SITE, d))) cpSync(join(SITE, d), resolve(import.meta.dirname, 'dist/play', d), { recursive: true })
    },
  }
}

// base './' so the built portal works from any folder (e.g. a future /portal/ path) without a server rewrite
export default defineConfig({
  base: './',
  plugins: [react(), enginePlayer()],
  server: { port: 5173, strictPort: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
