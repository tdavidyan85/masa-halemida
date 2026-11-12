import { ocrPath, playPath } from './staticFiles'

describe('files the portal serves next to itself', () => {
  it('serves the engine folders', () => {
    expect(playPath('/math/')).toBe('math/index.html')
    expect(playPath('/fractions/sw.js')).toBe('fractions/sw.js')
    expect(playPath('/icons/icon-192.png')).toBe('icons/icon-192.png')
    expect(playPath('/english')).toBe('english/index.html')
  })
  it('never anything outside them – however the path is written', () => {
    for (const bad of ['/../package.json', '/math/../../portal/.env.local', '/math/../src/build.py', '/%2e%2e/supabase/config.toml',
      '/math/%2e%2e/%2e%2e/etc/passwd', '/src/', '/supabase/functions/student-login/index.ts', '/math\\..\\x', '/%E0%A4%A', '/math/%00x', '/']) {
      const r = playPath(bad)
      expect(r === null || /^(math|english|fractions|icons)\//.test(r), bad).toBe(true)
      expect(r ?? '', bad).not.toMatch(/\.\./)
    }
    expect(playPath('/math/../../portal/.env.local')).toBeNull()
  })
  it('OCR files come only from the fixed list', () => {
    expect(ocrPath('/lang/heb.traineddata.gz')).toMatch(/heb\.traineddata\.gz$/)
    expect(ocrPath('/core/tesseract-core-simd-lstm.wasm.js')).toBe('tesseract.js-core/tesseract-core-simd-lstm.wasm.js')
    for (const bad of ['/../package.json', '/lang/../../.env', '/core/tesseract-core.wasm', '/constructor', '/__proto__']) expect(ocrPath(bad), bad).toBeNull()
  })
})
