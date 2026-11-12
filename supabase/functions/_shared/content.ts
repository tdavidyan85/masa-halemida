// Learning content from extracted text – no imports, so the portal (browser) and the Edge Functions (Deno) share it.
//   splitIntoTopics   text → editable topics (headings, numbered sections, or even chunks)
//   templatePack      topics → a masa-pack/1 DRAFT built by fixed rules (NOT AI): a short lesson per topic and
//                     fill-in-the-missing-word questions taken from the material's own sentences
//   checkPack         the structural rules of masa-pack/1 that a generated pack must pass before it is saved
// Every result is a draft: an adult reviews and approves it before any child sees it.

export interface Topic { title: string; body: string }
export interface PackMeta { subjectName: string; grade: string; unit: string }
type Json = Record<string, unknown>

const HEADING = /^(?:\d{1,2}[.)]\s+|[א-ת][.)]\s+|פרק\s|נושא\s|שיעור\s|חלק\s)?\S.{0,58}$/
function looksLikeHeading(line: string, next: string | undefined): boolean {
  const l = line.trim()
  if (!l || l.length > 60 || /[.!?,;]$/.test(l) || /^\d+$/.test(l)) return false
  if (/^(\d{1,2}[.)]|פרק|נושא|שיעור|חלק)\s/.test(l)) return true
  if (l.endsWith(':')) return true
  return HEADING.test(l) && !!next && next.trim().length > l.length * 1.5 && l.split(/\s+/).length <= 7
}

export function splitIntoTopics(text: string, maxTopics = 12): Topic[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  const lines = clean.split('\n')
  const topics: Topic[] = []
  let cur: Topic | null = null
  lines.forEach((line, i) => {
    if (looksLikeHeading(line, lines.slice(i + 1).find(x => x.trim()))) {
      cur = { title: line.trim().replace(/:$/, '').replace(/^(?:(?:פרק|נושא|שיעור|חלק)\s*\d{0,2}\s*[:.\-–]?\s*|(?:\d{1,2}|[א-ת])[.)]\s+)/, '').trim(), body: '' }
      topics.push(cur)
    } else if (line.trim()) {
      if (!cur) { cur = { title: '', body: '' }; topics.push(cur) }
      cur.body += (cur.body ? '\n' : '') + line.trim()
    }
  })
  let out = topics.filter(t => t.body.trim().length >= 20)
  if (out.length <= 1) {
    // no structure found: even chunks of about 120 words, cut at sentence ends
    const sentences = sentencesOf(clean)
    out = []
    let buf: string[] = [], words = 0
    for (const s of sentences) {
      buf.push(s); words += s.split(/\s+/).length
      if (words >= 120) { out.push({ title: '', body: buf.join(' ') }); buf = []; words = 0 }
    }
    if (buf.length) out.push({ title: '', body: buf.join(' ') })
  }
  return out.slice(0, maxTopics).map((t, i) => ({ title: (t.title || firstWords(t.body, 5) || `נושא ${i + 1}`).slice(0, 200), body: t.body.slice(0, 20000) }))
}

export function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 240)
}
const firstWords = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ')

/** content words worth asking about: 4+ letters, not a common function word */
const STOP = new Set(['הוא', 'היא', 'הם', 'הן', 'אנחנו', 'אתם', 'שלא', 'כאשר', 'אבל', 'בגלל', 'כמו', 'שלו', 'שלה', 'שלהם', 'גם', 'רק', 'כל', 'עוד',
  'מאוד', 'יותר', 'פחות', 'אשר', 'היה', 'היו', 'יהיה', 'להיות', 'אותו', 'אותה', 'אותם', 'זה', 'זאת', 'אלה', 'בין', 'לפני', 'אחרי', 'מתוך',
  'about', 'which', 'there', 'their', 'these', 'those', 'would', 'could', 'should', 'because', 'after', 'before'])
function keyWords(sentence: string): string[] {
  return sentence.split(/[\s,;:()"'״׳.!?–-]+/).filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w))
}

/** deterministic pseudo-random (same input → same draft, so reviews and tests are stable) */
function rng(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000 }
}

export function templatePack(topics: Topic[], meta: PackMeta): Json {
  const all = topics.flatMap(t => sentencesOf(t.body))
  const vocabulary = [...new Set(all.flatMap(keyWords))]
  const packTopics: Json[] = [], pools: Record<string, Json> = {}
  topics.forEach((t, ti) => {
    const r = rng(t.title + t.body.length)
    const items: Json[] = []
    for (const s of sentencesOf(t.body)) {
      if (items.length >= 8) break
      const words = keyWords(s)
      if (!words.length) continue
      const answer = words.reduce((a, b) => (b.length > a.length ? b : a))
      const distractors = vocabulary.filter(w => w !== answer && !s.includes(w)).sort(() => r() - 0.5).slice(0, 2)
      if (distractors.length < 2) continue
      const options = [answer, ...distractors].sort(() => r() - 0.5)
      items.push({ id: `q${items.length + 1}`, text: `איזו מילה חסרה?\n${s.replace(answer, '___')}`, options, answer, hint: `המילה מופיעה בחומר בנושא "${t.title}".` })
    }
    const lesson = { title: t.title.slice(0, 80), text: sentencesOf(t.body).slice(0, 3).join(' ').slice(0, 600) || t.body.slice(0, 600) }
    const topic: Json = { id: `t${ti + 1}`, name: t.title.slice(0, 60), glyph: String(ti + 1), bg: ['#cfe3ff', '#ffd9e4', '#d6f3e4', '#fff1b0', '#e5dcff'][ti % 5], lessons: [lesson], skills: [] }
    if (items.length) {
      const pool = `p${ti + 1}`
      pools[pool] = { defaults: { type: 'choice' }, items }
      ;(topic.skills as Json[]).push({ id: `s${ti + 1}`, name: `השלמת מילים: ${t.title.slice(0, 40)}`, pool })
    }
    packTopics.push(topic)
  })
  const firstSkill = packTopics.flatMap(t => t.skills as Json[])[0] as { id: string } | undefined
  return {
    schema: 'masa-pack/1',
    subject: { id: 'material', name: meta.subjectName, grade: meta.grade, unit: meta.unit },
    cfg: { examInfo: 'שאלות מתוך החומר שהועלה. נבדק ואושר בידי מבוגר.', testSay: 'בואו נתרגל את החומר!' },
    topics: packTopics,
    pools,
    exams: firstSkill ? [{ name: 'בוחן קצר', sections: packTopics.flatMap(t => (t.skills as Json[]).map(s => ({ skill: (s as { id: string }).id, n: 3, label: 'שאלה {n}' }))) }] : [],
    generator: { kind: 'template', note: 'נבנה לפי כללים קבועים מתוך הטקסט, ללא בינה מלאכותית' },
  }
}

/** structural rules of masa-pack/1 for generated content (the engine's own validator runs again when it is played) */
export function checkPack(p: unknown): string[] {
  const e: string[] = []
  const pack = p as Json
  if (!pack || typeof pack !== 'object') return ['not an object']
  if (pack.schema !== 'masa-pack/1') e.push('schema must be masa-pack/1')
  const subj = pack.subject as Json | undefined
  if (!subj || typeof subj.name !== 'string') e.push('subject.name missing')
  if (!Array.isArray(pack.topics) || !pack.topics.length) e.push('topics missing')
  const pools = (pack.pools ?? {}) as Record<string, Json>
  if (typeof pools !== 'object') e.push('pools missing')
  for (const t of (pack.topics as Json[]) ?? []) {
    if (typeof t.id !== 'string' || typeof t.name !== 'string') e.push('topic needs id and name')
    for (const s of (t.skills as Json[]) ?? []) if (!pools[String(s.pool)]) e.push(`skill ${String(s.id)}: pool ${String(s.pool)} missing`)
  }
  for (const [id, pool] of Object.entries(pools)) {
    const items = (pool.items ?? []) as Json[]
    if (!Array.isArray(items) || !items.length) { e.push(`pool ${id} has no items`); continue }
    for (const it of items) {
      const type = (it.type ?? (pool.defaults as Json | undefined)?.type ?? 'choice') as string
      if (typeof it.text !== 'string' || !it.text.trim()) e.push(`pool ${id}: item without text`)
      if (type === 'choice') {
        const opts = it.options as unknown[]
        if (!Array.isArray(opts) || opts.length < 2 || new Set(opts).size !== opts.length) e.push(`pool ${id}/${String(it.id)}: 2+ distinct options`)
        else if (!opts.includes(it.answer)) e.push(`pool ${id}/${String(it.id)}: answer not among options`)
      }
    }
  }
  if (JSON.stringify(pack).length > 280_000) e.push('pack too large')
  return e
}

/** extra rules for content that came from an AI provider (children will read it): sizes, and nothing that does not belong */
const ALLOWED_TAGS = /<\/?(en|m|f|mx)>/g
export function checkSafeContent(p: unknown): string[] {
  const e = checkPack(p)
  if (e.length) return e
  const pack = p as Json
  const topics = pack.topics as Json[], pools = Object.values(pack.pools as Record<string, Json>)
  const items = pools.flatMap(x => (x.items as Json[]) ?? [])
  if (topics.length > 12) e.push('too many topics (max 12)')
  if (items.length > 200) e.push('too many items (max 200)')
  const texts: string[] = []
  const walk = (v: unknown) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
  walk(topics); walk(pools)
  for (const t of texts) {
    if (t.length > 1200) { e.push('a text is too long'); break }
    const plain = t.replace(ALLOWED_TAGS, '')
    if (/<\s*\/?\s*[a-z!]/i.test(plain)) { e.push('HTML is not allowed'); break }
    if (/https?:\/\/|www\.|javascript:/i.test(plain)) { e.push('links are not allowed'); break }
    if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(plain)) { e.push('e-mail addresses are not allowed'); break }
    if (/(?:\+972|\b0)\d{1,2}[-\s]?\d{3}[-\s]?\d{4}\b/.test(plain)) { e.push('phone numbers are not allowed'); break }
  }
  return e
}
