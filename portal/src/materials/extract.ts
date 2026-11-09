// Text extraction, locally in the browser – nothing is sent anywhere to read a file.
//   PDF with a text layer → pdf.js (loaded only when needed)
//   images / scanned PDFs → not supported automatically yet (no free OCR that runs well locally for Hebrew
//                           without downloading large language data); the adult can paste or type the text.
export interface Extraction { text: string; pages: number }

export const ACCEPTED = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' } as const
export const MAX_BYTES = 20 * 1024 * 1024

/** checks before anything is uploaded (the server checks again) */
export function checkFile(f: { type: string; size: number; name: string }): string | null {
  if (!(f.type in ACCEPTED)) return 'אפשר להעלות רק PDF או תמונה (JPEG, PNG, WebP)'
  if (f.size <= 0) return 'הקובץ ריק'
  if (f.size > MAX_BYTES) return 'הקובץ גדול מדי (עד 20MB)'
  return null
}

export async function extractPdfText(data: ArrayBuffer, maxPages = 60): Promise<Extraction> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  const doc = await task.promise
  const pages = Math.min(doc.numPages, maxPages)
  const out: string[] = []
  for (let i = 1; i <= pages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    let line = ''
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue
      line += item.str
      if (item.hasEOL) { out.push(line.trim()); line = '' }
    }
    if (line.trim()) out.push(line.trim())
    out.push('')
  }
  const total = doc.numPages
  await task.destroy()
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), pages: total }
}
