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
