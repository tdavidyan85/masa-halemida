// Illustrated sample "profile pictures", drawn locally as SVG. The demo never uses or loads real photos.
const SKIN = ['#f9d7b5', '#f1c27d', '#e0ac69', '#c68642', '#8d5524']
const HAIR = ['#2b1d0e', '#5a3825', '#a0522d', '#d6a84f', '#1f1f1f', '#7b3f00']
const BG = ['#cfe3ff', '#ffd9e4', '#d6f3e4', '#fff1b0', '#e5dcff', '#ffe0c4']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function sampleAvatar(seed: string, opts: { long?: boolean; child?: boolean } = {}): string {
  const h = hash(seed)
  const skin = SKIN[h % SKIN.length]
  const hair = HAIR[(h >>> 3) % HAIR.length]
  const bg = BG[(h >>> 6) % BG.length]
  const eyeY = opts.child ? 52 : 48
  const longHair = opts.long
    ? `<path d="M22 50 C20 26 34 16 50 16 C66 16 80 26 78 50 L80 78 L66 78 L66 50 L34 50 L34 78 L20 78 Z" fill="${hair}"/>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="50" fill="${bg}"/>${longHair}
<path d="M24 100 C26 78 38 72 50 72 C62 72 74 78 76 100 Z" fill="${['#5b5bd6', '#ff8a3d', '#2fb67c', '#e85d8f'][(h >>> 9) % 4]}"/>
<circle cx="50" cy="${opts.child ? 50 : 46}" r="${opts.child ? 22 : 21}" fill="${skin}"/>
<path d="M28 ${opts.child ? 46 : 42} C28 26 72 26 72 ${opts.child ? 46 : 42} C64 34 40 32 28 ${opts.child ? 46 : 42} Z" fill="${hair}"/>
<circle cx="42" cy="${eyeY}" r="2.6" fill="#1b2a4a"/><circle cx="58" cy="${eyeY}" r="2.6" fill="#1b2a4a"/>
<path d="M43 ${eyeY + 9} Q50 ${eyeY + 14} 57 ${eyeY + 9}" stroke="#1b2a4a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
