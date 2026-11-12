import { checkFile } from './extract'

describe('file checks before upload', () => {
  it('accepts PDF and images up to 20MB', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) expect(checkFile({ type, size: 1000, name: 'x' })).toBeNull()
  })
  it('refuses other types, empty and too large files', () => {
    expect(checkFile({ type: 'text/html', size: 10, name: 'x.html' })).toMatch(/רק PDF/)
    expect(checkFile({ type: 'application/x-msdownload', size: 10, name: 'x.exe' })).toMatch(/רק PDF/)
    expect(checkFile({ type: 'application/pdf', size: 0, name: 'x' })).toMatch(/ריק/)
    expect(checkFile({ type: 'application/pdf', size: 21 * 1024 * 1024, name: 'x' })).toMatch(/גדול מדי/)
  })
})

import { dropRepeatedLines, fixRtlLine, stripBidiMarks } from './extract'
describe('PDF text clean-up', () => {
  it('OCR text loses invisible direction marks (found in the browser run)', () => {
    expect(stripBidiMarks('מחזור המים\n\u200eThe water cycle\u200f')).toBe('מחזור המים\nThe water cycle')
  })
  it('turns a visually-ordered (reversed) Hebrew line back, keeping numbers readable', () => {
    expect(fixRtlLine('םימה רוזחמ 12 קרפ')).toBe('פרק 12 מחזור המים')
    expect(fixRtlLine('פרק 12 מחזור המים')).toBe('פרק 12 מחזור המים')          // already logical: untouched
    expect(fixRtlLine('The water cycle')).toBe('The water cycle')
  })
  it('drops running headers/footers and page numbers that repeat on most pages', () => {
    const pages = [1, 2, 3, 4].map(n => ['חוברת מדעים – כיתה ה', `תוכן עמוד ${n} שונה`, String(n)])
    expect(dropRepeatedLines(pages)).toEqual([1, 2, 3, 4].map(n => [`תוכן עמוד ${n} שונה`]))
  })
  it('never drops content lines that only differ by a number (regression)', () => {
    const pages = [1, 2, 3].map(n => [`עמוד ${n}`, `תרגיל ${n}: חברו את המספרים`, `תרגיל ${n + 10}: חסרו`, 'סוף'])
    expect(dropRepeatedLines(pages)).toEqual([1, 2, 3].map(n => [`תרגיל ${n}: חברו את המספרים`, `תרגיל ${n + 10}: חסרו`]))
  })
})
