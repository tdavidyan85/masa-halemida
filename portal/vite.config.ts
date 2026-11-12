/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

import { OCR_FILES, PLAY_DIRS, ocrPath, playPath } from './src/build/staticFiles'

// Served next to the portal (rules in src/build/staticFiles.ts, tested):
//   /play/…  the existing learning engine (the published site folders, unchanged) – same origin, so the portal can
//            listen to its progress without changing it
//   /ocr/…   the local OCR engine and its Hebrew/English data – OCR runs in the browser, nothing goes to a third party
const SITE = resolve(import.meta.dirname, '..')
const MODULES = resolve(import.meta.dirname, 'node_modules')
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.gz': 'application/gzip' }

function sendFile(res: import('node:http').ServerResponse, file: string) {
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
}

function sideFiles(): Plugin {
  return {
    name: 'masa-side-files',
    configureServer(server) {
      server.middlewares.use('/play', (req, res, next) => {
        const rel = playPath(req.url ?? '/')
        const file = rel && join(SITE, rel)
        if (!file || !file.startsWith(SITE + '/') || !existsSync(file) || !statSync(file).isFile()) return next()
        sendFile(res, file)
      })
      server.middlewares.use('/ocr', (req, res, next) => {
        const rel = ocrPath(req.url ?? '/')
        const file = rel && join(MODULES, rel)
        if (!file || !existsSync(file)) return next()
        sendFile(res, file)
      })
    },
    closeBundle() {
      for (const d of PLAY_DIRS) if (existsSync(join(SITE, d))) cpSync(join(SITE, d), resolve(import.meta.dirname, 'dist/play', d), { recursive: true })
      for (const [pub, src] of Object.entries(OCR_FILES)) cpSync(join(MODULES, src), resolve(import.meta.dirname, 'dist/ocr', pub))
    },
  }
}

// base './' so the built portal works from any folder (e.g. a future /portal/ path) without a server rewrite
export default defineConfig({
  base: './',
  plugins: [react(), sideFiles()],
  server: { port: 5173, strictPort: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
