// Text extraction, locally in the browser – files are never sent anywhere to be read.
//   PDF with a text layer → pdf.js; pages without one (scans) → rendered and read by the local OCR engine
//   images → local OCR (tesseract.js, Hebrew + English, served by the portal itself – no third-party service)
// The adult always sees the result, the OCR confidence and the uncertain words, and can correct everything.
export interface Extraction {
  text: string
  pages: number
  /** OCR confidence 0–100 (absent when the PDF's own text layer was used) */
  confidence?: number
  /** words the OCR was unsure about, to check by eye */
  uncertain?: string[]
  method: 'pdf-text' | 'ocr' | 'mixed'
}

export const ACCEPTED = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' } as const
export const MAX_BYTES = 20 * 1024 * 1024

/** checks before anything is uploaded (the server checks again) */
export function checkFile(f: { type: string; size: number; name: string }): string | null {
  if (!(f.type in ACCEPTED)) return 'אפשר להעלות רק PDF או תמונה (JPEG, PNG, WebP)'
  if (f.size <= 0) return 'הקובץ ריק'
  if (f.size > MAX_BYTES) return 'הקובץ גדול מדי (עד 20MB)'
  return null
}

const HEB = /[֐-׿]/
const FINALS = 'ךםןףץ'
/**
 * Some PDFs store Hebrew in VISUAL order (each line reversed). Final letters (ך ם ן ף ץ) only end a word, so when
 * they mostly START words, the line is reversed. Numbers and Latin runs are kept readable.
 */
export function fixRtlLine(line: string): string {
  if (!HEB.test(line)) return line
  const words = line.split(/\s+/).filter(w => HEB.test(w))
  const startsFinal = words.filter(w => FINALS.includes(w[0])).length
  const endsFinal = words.filter(w => FINALS.includes(w[w.length - 1])).length
  if (startsFinal <= endsFinal || startsFinal === 0) return line
  return [...line].reverse().join('').replace(/[0-9A-Za-z][0-9A-Za-z.,:%/-]*/g, run => [...run].reverse().join(''))
}

/** lines that repeat on most pages (running headers/footers, page numbers) are noise for learning content */
export function dropRepeatedLines(pages: string[][]): string[][] {
  if (pages.length < 3) return pages
  // only a page's FIRST and LAST line can be a running header/footer – content lines that merely differ by a
  // number ("exercise 1", "exercise 2") must never be dropped
  const key = (l: string) => l.trim().replace(/\d+/g, '#')
  const edges = (p: string[]) => { const t = p.filter(l => l.trim()); return [t[0], t[t.length - 1]].filter(Boolean).map(key) }
  const count = new Map<string, number>()
  for (const p of pages) for (const l of new Set(edges(p))) count.set(l, (count.get(l) ?? 0) + 1)
  const noise = new Set([...count].filter(([, n]) => n >= Math.ceil(pages.length * 0.6)).map(([l]) => l))
  return pages.map(p => {
    const t = p.filter(l => l.trim())
    return t.filter((l, i) => !((i === 0 || i === t.length - 1) && (noise.has(key(l)) || /^\s*[-–]?\s*\d{1,3}\s*[-–]?\s*$/.test(l))))
  })
}

export interface OcrResult { text: string; confidence: number; uncertain: string[] }
/** OCR output carries invisible direction marks (U+200E/200F, embeddings) – they must not end up in questions */
export const stripBidiMarks = (s: string) => s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
type Progress = (fraction: number) => void

/** local OCR (Hebrew + English). Engine, worker and language data come from the portal itself (/ocr/…). */
export async function ocrImage(image: Blob | HTMLCanvasElement, onProgress?: Progress): Promise<OcrResult> {
  const { createWorker, OEM } = await import('tesseract.js')
  const base = new URL('ocr/', document.baseURI).href
  const worker = await createWorker(['heb', 'eng'], OEM.LSTM_ONLY, {
    workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang', gzip: true, workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress) },
  })
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    type Word = { text: string; confidence: number }
    const words: Word[] = (data.blocks ?? []).flatMap((b: { paragraphs: { lines: { words: Word[] }[] }[] }) => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)))
    const uncertain = [...new Set(words.filter(w => w.confidence < 60 && w.text.trim().length > 1).map(w => stripBidiMarks(w.text).trim()))].slice(0, 40)
    return { text: stripBidiMarks(data.text ?? '').trim(), confidence: Math.round(data.confidence ?? 0), uncertain }
  } finally {
    await worker.terminate()
  }
}

export async function extractPdfText(data: ArrayBuffer, opts: { maxPages?: number; ocrScans?: boolean; onProgress?: Progress } = {}): Promise<Extraction> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  const doc = await task.promise
  const total = doc.numPages, n = Math.min(total, opts.maxPages ?? 60)
  const pages: string[][] = [], scans: number[] = []
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const lines: string[] = []
    let line = ''
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue
      line += item.str
      if (item.hasEOL) { lines.push(fixRtlLine(line.trim())); line = '' }
    }
    if (line.trim()) lines.push(fixRtlLine(line.trim()))
    pages.push(lines)
    if (lines.join('').trim().length < 20) scans.push(i)          // no real text layer: a scanned page
    opts.onProgress?.(i / n / 2)
  }
  let confidences: number[] = [], uncertain: string[] = []
  if (opts.ocrScans !== false && scans.length) {
    for (const [k, i] of scans.entries()) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width; canvas.height = viewport.height
      await page.render({ canvas, viewport }).promise
      const r = await ocrImage(canvas, f => opts.onProgress?.(0.5 + (k + f) / scans.length / 2))
      pages[i - 1] = r.text.split('\n')
      confidences.push(r.confidence); uncertain = [...uncertain, ...r.uncertain]
    }
  }
  await task.destroy()
  const text = dropRepeatedLines(pages).map(p => p.join('\n')).join('\n\n')
    .replace(/(\S)-\n(\S)/g, '$1$2')                 // words hyphenated across lines
    .replace(/\n{3,}/g, '\n\n').trim()
  const method = !scans.length ? 'pdf-text' : scans.length === n ? 'ocr' : 'mixed'
  return { text, pages: total, method,
    ...(confidences.length ? { confidence: Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length), uncertain: [...new Set(uncertain)].slice(0, 40) } : {}) }
}

export async function extractImageText(image: Blob, onProgress?: Progress): Promise<Extraction> {
  const r = await ocrImage(image, onProgress)
  return { text: r.text, pages: 1, confidence: r.confidence, uncertain: r.uncertain, method: 'ocr' }
}
