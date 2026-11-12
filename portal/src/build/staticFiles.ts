// Which extra files the portal serves next to itself (dev server and build), decided WITHOUT touching the disk,
// so the rules can be tested: the existing engine's folders under /play/, and the local OCR engine under /ocr/.
// Nothing outside these lists is ever served: no "..", no other folders, no absolute paths.
import { posix } from 'node:path'

export const PLAY_DIRS = ['math', 'english', 'fractions', 'icons']

/** published OCR path → file inside portal/node_modules (exact list) */
export const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'lang/heb.traineddata.gz': '@tesseract.js-data/heb/4.0.0_best_int/heb.traineddata.gz',
  'lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  ...Object.fromEntries(['lstm', 'simd-lstm', 'relaxedsimd-lstm'].flatMap(v => [
    [`core/tesseract-core-${v}.wasm.js`, `tesseract.js-core/tesseract-core-${v}.wasm.js`],
    [`core/tesseract-core-${v}.wasm`, `tesseract.js-core/tesseract-core-${v}.wasm`],
  ])),
}

/** "/math/" → "math/index.html"; anything outside the engine folders → null */
export function playPath(url: string): string | null {
  let p: string
  try { p = decodeURIComponent(url.split('?')[0]) } catch { return null }
  if (p.includes('\0') || p.includes('\\')) return null
  const n = posix.normalize('/' + p).replace(/^\/+/, '')
  if (!n || n.startsWith('..') || !PLAY_DIRS.includes(n.split('/')[0])) return null
  return n.endsWith('/') || !n.includes('/') ? posix.join(n, 'index.html') : n
}

export function ocrPath(url: string): string | null {
  const p = url.split('?')[0].replace(/^\/+/, '')
  return Object.prototype.hasOwnProperty.call(OCR_FILES, p) ? OCR_FILES[p] : null
}
