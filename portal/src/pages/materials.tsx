// Learning materials for teachers and parents: upload → text → topics → content draft → review → share / quiz.
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState, ErrorState, Loading } from '../components/States'
import { Badge, Card, PageHeader, ProgressBar, formatDate } from '../components/ui'
import { useData } from '../data'
import { DemoOnlyError } from '../data/source'
import type { ContentDraft, Group, MaterialDetail, MaterialTopic } from '../data/types'
import { useAsync } from '../hooks/useAsync'
import { ACCEPTED, checkFile, extractImageText, extractPdfText } from '../materials/extract'
import type { Extraction } from '../materials/extract'
import { splitIntoTopics } from '../../../supabase/functions/_shared/content'

const EXTRACTION: Record<string, [string, 'neutral' | 'good' | 'warn' | 'bad' | 'info']> = {
  pending: ['טקסט: עוד לא חולץ', 'neutral'], done: ['טקסט מוכן', 'good'], failed: ['לא נמצא טקסט', 'warn'], unsupported: ['תמונה: לזיהוי טקסט', 'info'],
}
const base = (role: string) => (role === 'parent' ? '/parent/materials' : '/teacher/materials')

export function MaterialsPage() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.myMaterials(s), [data, s.userId])
  return (
    <>
      <PageHeader emoji="📄" title="חומרי לימוד" subtitle="מעלים PDF או צילום של דף, מחלקים לנושאים, ויוצרים ממנו תרגול. שום תוכן לא מגיע לילד לפני שאישרת אותו." />
      <UploadCard onDone={st.reload} />
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState emoji="📄" title="עוד לא העלית חומרים" />}>
        {list => (
          <Card><ul className="list">{list.map(m => (
            <li key={m.id} className="list-row">
              <Link to={`${base(s.role)}/${m.id}`} className="link"><b>📄 {m.title}</b><small className="muted block" dir="ltr">{m.fileName}{m.sizeBytes ? ` · ${Math.ceil(m.sizeBytes / 1024)}KB` : ''}</small></Link>
              <span className="row wrap">{m.extractionStatus && <Badge tone={EXTRACTION[m.extractionStatus][1]}>{EXTRACTION[m.extractionStatus][0]}</Badge>}<small className="muted">{formatDate(m.uploadedAt)}</small></span>
            </li>
          ))}</ul></Card>
        )}
      </AsyncView>
    </>
  )
}

function UploadCard({ onDone }: { onDone(): void }) {
  const data = useData(), s = useSession(), navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (!file) return setErr('צריך לבחור קובץ')
    const bad = checkFile(file)
    if (bad) return setErr(bad)
    setBusy(true)
    try { const m = await data.uploadMaterial(s, file, title); onDone(); navigate(`${base(s.role)}/${m.id}`) }
    catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card title="העלאת חומר" className="form-card">
      <form onSubmit={submit} className="form-grid" noValidate>
        <label className="field">קובץ (PDF, JPEG, PNG, WebP · עד 20MB)
          <input type="file" accept={Object.keys(ACCEPTED).join(',')} onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); setErr(f ? checkFile(f) ?? '' : ''); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '')) }} />
        </label>
        <label className="field">שם החומר<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
        <p className="wide small muted">הקובץ נשמר באחסון פרטי. כדאי לכסות שמות ופרטים אישיים לפני ההעלאה.</p>
        {err && <p className="form-error wide" role="alert">{err}</p>}
        <div className="wide"><button className="btn btn-primary" disabled={busy}>{busy ? 'מעלים…' : 'העלאה'}</button></div>
      </form>
    </Card>
  )
}

export function MaterialPage() {
  const { materialId = '' } = useParams()
  const data = useData(), s = useSession()
  const st = useAsync(() => data.materialDetail(s, materialId), [data, s.userId, materialId])
  return (
    <>
      <Link to={base(s.role)} className="back-link">→ לכל החומרים</Link>
      <AsyncView state={st}>
        {d => <MaterialWorkspace d={d} reload={st.reload} />}
      </AsyncView>
    </>
  )
}

function MaterialWorkspace({ d, reload }: { d: MaterialDetail; reload(): void }) {
  const data = useData(), s = useSession()
  const m = d.material
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'note'; text: string } | null>(null)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try { await fn(); setMsg({ kind: 'ok', text: ok }); reload() }
    catch (e) { setMsg({ kind: e instanceof DemoOnlyError ? 'note' : 'error', text: (e as Error).message }) }
  }
  async function open() {
    try { window.open(await data.materialFileUrl(s, m.id), '_blank', 'noopener') } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }) }
  }
  return (
    <>
      <PageHeader emoji="📄" title={m.title} subtitle={`${m.mimeType ? ACCEPTED[m.mimeType as keyof typeof ACCEPTED] : ''}${m.pages ? ` · ${m.pages} עמ׳` : ''} · ${formatDate(m.uploadedAt)}`}
        actions={<button className="btn btn-secondary" onClick={open}>פתיחת הקובץ</button>} />
      {msg && <p className={msg.kind === 'ok' ? 'form-ok' : msg.kind === 'note' ? 'form-note' : 'form-error'} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
      {!d.owner ? <Card><p>החומר שותף איתך. אפשר לפתוח את הקובץ.</p></Card> : (
        <>
          <TextStep d={d} run={run} />
          <TopicsStep d={d} run={run} />
          <ContentStep d={d} run={run} />
          <ShareStep d={d} run={run} />
        </>
      )}
    </>
  )
}
type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>

function TextStep({ d, run }: { d: MaterialDetail; run: Run }) {
  const data = useData(), s = useSession()
  const [text, setText] = useState(d.text ?? '')
  const [progress, setProgress] = useState<number | null>(null)
  const [info, setInfo] = useState<{ method: Extraction['method']; confidence?: number; uncertain?: string[] } | null>(
    d.material.extractionConfidence != null ? { method: 'ocr', confidence: d.material.extractionConfidence } : null)
  const isPdf = d.material.mimeType === 'application/pdf'
  async function extract(file?: Blob) {
    setProgress(0)
    await run(async () => {
      const blob = file ?? await (await fetch(await data.materialFileUrl(s, d.material.id))).blob()
      const r = isPdf ? await extractPdfText(await blob.arrayBuffer(), { onProgress: setProgress }) : await extractImageText(blob, setProgress)
      if (!r.text.trim()) throw new Error('לא נמצא טקסט. אפשר להקליד או להדביק אותו כאן.')
      setText(r.text); setInfo(r)
      await data.saveExtraction(s, d.material.id, r.text, r.pages, r.confidence)
    }, 'הטקסט חולץ ונשמר. כדאי לעבור עליו ולתקן.')
    setProgress(null)
  }
  return (
    <Card title="1. הטקסט">
      <p className="small muted">{isPdf ? 'קוראים את הטקסט מה-PDF. דפים סרוקים עוברים זיהוי טקסט (OCR).' : 'זיהוי טקסט מהתמונה (OCR) בעברית ובאנגלית.'} הכול נעשה במחשב שלך, והקובץ לא נשלח לשום שירות.</p>
      <div className="row wrap">
        <button className="btn btn-primary" disabled={progress !== null} onClick={() => extract()}>{progress !== null ? 'מחלצים…' : 'חילוץ טקסט'}</button>
        <label className="small">או מקובץ מהמחשב: <input type="file" accept={isPdf ? 'application/pdf' : 'image/*'} aria-label="קובץ לחילוץ" onChange={e => { const f = e.target.files?.[0]; if (f) void extract(f) }} /></label>
      </div>
      {progress !== null && <ProgressBar value={progress * 100} label="התקדמות החילוץ" />}
      {info?.confidence !== undefined && (
        <div className={`ocr-info ${info.confidence < 70 ? 'low' : ''}`} role="status">
          <b>רמת ביטחון של הזיהוי: {info.confidence}%</b>{info.confidence < 70 && ' · כדאי לבדוק את הטקסט בעיון'}
          {!!info.uncertain?.length && <div className="small">מילים שכדאי לבדוק: {info.uncertain.map(w => <mark key={w}>{w}</mark>)}</div>}
        </div>
      )}
      <label className="field" style={{ marginTop: 10 }}>הטקסט (אפשר לתקן)<textarea rows={8} value={text} onChange={e => setText(e.target.value)} dir="auto" /></label>
      <button className="btn btn-secondary" onClick={() => run(() => data.saveExtraction(s, d.material.id, text, d.material.pages, info?.confidence), 'הטקסט נשמר')}>שמירת הטקסט</button>
    </Card>
  )
}

function TopicsStep({ d, run }: { d: MaterialDetail; run: Run }) {
  const data = useData(), s = useSession()
  const [topics, setTopics] = useState<MaterialTopic[]>(d.topics)
  useEffect(() => setTopics(d.topics), [d.topics])
  const set = (i: number, patch: Partial<MaterialTopic>) => setTopics(ts => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  return (
    <Card title="2. נושאים">
      <p className="small muted">חלוקה אוטומטית לפי כותרות ופסקאות. אפשר לשנות שמות, לערוך, להוסיף ולמחוק.</p>
      <div className="row wrap">
        <button className="btn btn-secondary" disabled={!d.text} onClick={() => setTopics(splitIntoTopics(d.text ?? ''))}>חלוקה אוטומטית לנושאים</button>
        <button className="btn btn-ghost" onClick={() => setTopics(t => [...t, { title: '', body: '' }])}>+ נושא</button>
      </div>
      {topics.length === 0 ? <EmptyState emoji="🗂️" title="עוד אין נושאים" message={d.text ? 'לוחצים על "חלוקה אוטומטית".' : 'קודם שומרים טקסט.'} /> : topics.map((t, i) => (
        <fieldset key={i} className="q-row quiz-editor" style={{ marginTop: 10 }}>
          <legend className="small">נושא {i + 1}</legend>
          <input aria-label={`שם נושא ${i + 1}`} value={t.title} onChange={e => set(i, { title: e.target.value })} style={{ width: '100%' }} />
          <textarea aria-label={`תוכן נושא ${i + 1}`} rows={3} value={t.body} onChange={e => set(i, { body: e.target.value })} style={{ width: '100%', marginTop: 6 }} />
          <span className="row wrap">
            <button className="btn btn-small btn-ghost" disabled={i === 0} aria-label={`להזיז את נושא ${i + 1} למעלה`} onClick={() => setTopics(ts => { const c = [...ts]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })}>↑</button>
            <button className="btn btn-small btn-ghost" disabled={i === topics.length - 1} aria-label={`להזיז את נושא ${i + 1} למטה`} onClick={() => setTopics(ts => { const c = [...ts]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c })}>↓</button>
            <button className="btn btn-small btn-ghost" onClick={() => setTopics(ts => ts.filter((_, j) => j !== i))}>מחיקה</button>
          </span>
        </fieldset>
      ))}
      {topics.length > 0 && <button className="btn btn-primary" onClick={() => run(() => data.saveTopics(s, d.material.id, topics), 'הנושאים נשמרו')}>שמירת הנושאים</button>}
    </Card>
  )
}

type PackItem = { id: string; text: string; options?: string[]; answer?: string; hint?: string }
type Pack = { topics?: { name: string; lessons?: { title: string; text: string }[] }[]; pools?: Record<string, { items: PackItem[] }>; generator?: { kind?: string; edited?: boolean } }
const itemsOf = (p: Pack) => Object.entries(p.pools ?? {}).flatMap(([k, pool]) => pool.items.map(it => ({ key: `${k}/${it.id}`, pool: k, it })))

/** a draft: preview, edit before approval, choose questions for a quiz after approval */
function DraftCard({ dr, d, run }: { dr: ContentDraft; d: MaterialDetail; run: Run }) {
  const data = useData(), s = useSession(), navigate = useNavigate()
  const [pack, setPack] = useState<Pack>(dr.pack as Pack)
  const [editing, setEditing] = useState(false)
  const [chosen, setChosen] = useState<string[]>(() => itemsOf(dr.pack as Pack).filter(x => Array.isArray(x.it.options)).map(x => x.key))
  const [target, setTarget] = useState('')
  const groups = useAsync(() => (s.role === 'teacher' ? data.myGroups(s) : Promise.resolve([] as Group[])), [data, s.userId])
  const items = itemsOf(pack)
  const setItem = (pool: string, id: string, patch: Partial<PackItem>) => setPack(p => ({ ...p, pools: { ...p.pools, [pool]: { ...p.pools![pool], items: p.pools![pool].items.map(it => (it.id === id ? { ...it, ...patch } : it)) } } }))
  const removeItem = (pool: string, id: string) => setPack(p => ({ ...p, pools: { ...p.pools, [pool]: { ...p.pools![pool], items: p.pools![pool].items.filter(it => it.id !== id) } } }))
  const status = dr.status === 'approved' ? 'אושר' : dr.status === 'rejected' ? 'נדחה' : 'ממתין לבדיקה'
  return (
    <li className="draft-card">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span className="row wrap">
          <Badge tone={dr.provider === 'ai' ? 'info' : 'neutral'}>{dr.provider === 'ai' ? 'נוצר ב-AI' : 'תבנית, ללא AI'}</Badge>
          {(dr.pack as Pack).generator?.edited && <Badge>נערך בידי מבוגר</Badge>}
          <span className={`status-pill status-${dr.status === 'approved' ? 'published' : dr.status === 'rejected' ? 'archived' : 'draft'}`}>{status}</span>
          <span className="small muted">{pack.topics?.length ?? 0} נושאים · {items.length} שאלות</span>
        </span>
        {dr.status === 'draft' && <span className="row wrap">
          {!editing && <button className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>עריכה</button>}
          <button className="btn btn-small btn-primary" onClick={() => run(() => data.reviewDraft(s, dr.id, true), 'התוכן אושר')}>אישור</button>
          <button className="btn btn-small btn-secondary" onClick={() => run(() => data.reviewDraft(s, dr.id, false), 'התוכן נדחה')}>דחייה</button>
        </span>}
      </div>
      {/* opened for editing, and after approval so the teacher can pick the quiz questions */}
      <details className="draft-preview" open={editing || (dr.status === 'approved' && s.role === 'teacher')}>
        <summary>לצפייה{dr.status === 'draft' ? ' ולעריכה' : ''}</summary>
        {pack.topics?.map((t, i) => <div key={i}><b>{t.name}</b>{t.lessons?.map((l, j) => <p key={j} className="small">{l.text}</p>)}</div>)}
        <ol className="draft-items">{items.map(({ key, pool, it }) => (
          <li key={key}>
            {editing ? (
              <div className="quiz-editor">
                <input aria-label={`ניסוח ${it.id}`} value={it.text} onChange={e => setItem(pool, it.id, { text: e.target.value })} style={{ width: '100%' }} />
                {it.options?.map((o, j) => (
                  <div key={j} className="opt-row">
                    <input type="radio" name={`a-${key}`} aria-label={`תשובה נכונה ${it.id} ${j + 1}`} checked={it.answer === o} onChange={() => setItem(pool, it.id, { answer: o })} />
                    <input type="text" aria-label={`תשובה ${it.id} ${j + 1}`} value={o} onChange={e => setItem(pool, it.id, { options: it.options!.map((x, k) => (k === j ? e.target.value : x)), ...(it.answer === o ? { answer: e.target.value } : {}) })} />
                  </div>
                ))}
                <button className="btn btn-small btn-ghost" onClick={() => removeItem(pool, it.id)}>הסרת השאלה</button>
              </div>
            ) : (
              <label className="check">
                {dr.status === 'approved' && s.role === 'teacher' && it.options && <input type="checkbox" checked={chosen.includes(key)} aria-label={`לכלול במבחן: ${it.text}`}
                  onChange={e => setChosen(c => (e.target.checked ? [...c, key] : c.filter(x => x !== key)))} />}
                <span className="small">{it.text.replace('\n', ' – ')}{it.options ? ` [${it.options.join(' / ')}] ✓ ${it.answer}` : ''}</span>
              </label>
            )}
          </li>
        ))}</ol>
        {editing && <div className="row wrap">
          <button className="btn btn-small btn-primary" onClick={() => run(async () => { await data.updateDraft(s, dr.id, pack as Record<string, unknown>); setEditing(false) }, 'השינויים בטיוטה נשמרו')}>שמירת השינויים</button>
          <button className="btn btn-small btn-ghost" onClick={() => { setPack(dr.pack as Pack); setEditing(false) }}>ביטול</button>
        </div>}
      </details>
      {dr.status === 'approved' && s.role === 'teacher' && groups.data && groups.data.length > 0 && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <select aria-label="לאיזו קבוצה" value={target} onChange={e => setTarget(e.target.value)}><option value="">קבוצה…</option>{groups.data.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
          <button className="btn btn-small btn-primary" disabled={!target || !chosen.length}
            onClick={() => run(async () => { await data.quizFromDraft(s, dr.id, target, `מבחן: ${d.material.title}`, chosen); navigate('/teacher/assignments') }, 'נוצר מבחן (טיוטה)')}>
            יצירת מבחן ({chosen.length} שאלות)</button>
        </div>
      )}
    </li>
  )
}

function ContentStep({ d, run }: { d: MaterialDetail; run: Run }) {
  const data = useData(), s = useSession()
  const meta = { subjectName: 'כללי', grade: 'ה' }
  return (
    <Card title="3. תוכן לתרגול (טיוטה ובדיקה)">
      <p className="small muted">כל תוכן נוצר כטיוטה. אפשר לערוך שאלות לפני האישור, וילד לא רואה דבר לפני שאישרת.</p>
      <div className="row wrap">
        <button className="btn btn-secondary" disabled={!d.topics.length} onClick={() => run(() => data.createTemplateDraft(s, d.material.id, meta), 'נוצרה טיוטה לפי תבנית')}>יצירה לפי תבנית (ללא AI)</button>
        <button className="btn btn-secondary" disabled={!d.topics.length} onClick={() => run(() => data.requestAiDraft(s, d.material.id, meta), 'נוצרה טיוטה עם AI')}>יצירה עם AI</button>
      </div>
      {d.drafts.length === 0 ? <p className="muted">עוד אין טיוטות.</p> : <ul className="list">{d.drafts.map(dr => <DraftCard key={dr.id} dr={dr} d={d} run={run} />)}</ul>}
    </Card>
  )
}

function ShareStep({ d, run }: { d: MaterialDetail; run: Run }) {
  const data = useData(), s = useSession()
  const targets = useAsync(async () => s.role === 'teacher'
    ? (await data.myGroups(s)).filter(g => !g.archived).map(g => ({ id: g.id, name: g.name, kind: 'group' as const }))
    : (await data.myChildren(s)).map(k => ({ id: k.student.id, name: k.student.fullName, kind: 'child' as const })), [data, s.userId])
  return (
    <Card title={s.role === 'teacher' ? '4. שיתוף עם קבוצה' : '4. שיתוף עם ילד/ה'}>
      <AsyncView state={targets} isEmpty={l => l.length === 0} empty={<p className="muted">אין עם מי לשתף עדיין.</p>}>
        {list => (
          <ul className="list">{list.map(t => {
            const shared = d.shares.some(x => x.groupId === t.id || x.studentId === t.id)
            return (
              <li key={t.id} className="list-row"><span>{t.name}</span>
                {shared ? <Badge tone="good">משותף</Badge>
                  : <button className="btn btn-small btn-secondary" onClick={() => run(() => data.shareMaterial(s, d.material.id, t.kind === 'group' ? { groupId: t.id } : { studentId: t.id }), `שותף עם ${t.name}`)}>שיתוף</button>}
              </li>
            )
          })}</ul>
        )}
      </AsyncView>
    </Card>
  )
}

/** for students (and parents): materials others shared with them – read-only */
export function SharedMaterials() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.sharedWithMe(s), [data, s.userId])
  const [err, setErr] = useState('')
  if (st.loading) return <Loading rows={1} />
  if (st.error) return <ErrorState message={st.error.message} onRetry={st.reload} />
  if (!st.data?.length) return null
  return (
    <section style={{ marginTop: 22 }}>
      <h2>📚 חומרים ששותפו איתי</h2>
      {err && <p className="form-error" role="alert">{err}</p>}
      <ul className="history">{st.data.map(m => (
        <li key={m.id}><span>📄 {m.title}</span>
          <button className="btn btn-small btn-secondary" onClick={async () => { try { window.open(await data.materialFileUrl(s, m.id), '_blank', 'noopener') } catch (e) { setErr((e as Error).message) } }}>פתיחה</button></li>
      ))}</ul>
    </section>
  )
}
