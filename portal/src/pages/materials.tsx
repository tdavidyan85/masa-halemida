// Learning materials for teachers and parents: upload → text → topics → content draft → review → share / quiz.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState, ErrorState, Loading } from '../components/States'
import { Badge, Card, PageHeader, formatDate } from '../components/ui'
import { useData } from '../data'
import { DemoOnlyError } from '../data/source'
import type { ContentDraft, Group, MaterialDetail, MaterialTopic } from '../data/types'
import { useAsync } from '../hooks/useAsync'
import { ACCEPTED, checkFile, extractPdfText } from '../materials/extract'
import { splitIntoTopics } from '../../../supabase/functions/_shared/content'

const EXTRACTION: Record<string, [string, 'neutral' | 'good' | 'warn' | 'bad' | 'info']> = {
  pending: ['טקסט: עוד לא חולץ', 'neutral'], done: ['טקסט מוכן', 'good'], failed: ['לא נמצא טקסט', 'warn'], unsupported: ['תמונה: מקלידים טקסט', 'info'],
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
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const isPdf = d.material.mimeType === 'application/pdf'
  async function extract(file: File) {
    setBusy(true)
    await run(async () => {
      const r = await extractPdfText(await file.arrayBuffer())
      if (!r.text.trim()) throw new Error('לא נמצא טקסט ב-PDF (אולי זו סריקה). אפשר להקליד או להדביק את הטקסט כאן.')
      setText(r.text)
      await data.saveExtraction(s, d.material.id, r.text, r.pages)
    }, 'הטקסט חולץ ונשמר')
    setBusy(false)
  }
  return (
    <Card title="1. הטקסט">
      {isPdf
        ? <p className="small muted">החילוץ נעשה במחשב שלך, בלי לשלוח את הקובץ לשום שירות. בוחרים שוב את אותו קובץ PDF:</p>
        : <p className="small muted">זיהוי טקסט מתמונה (OCR) עוד לא נתמך אוטומטית. אפשר להקליד או להדביק את הטקסט שבדף.</p>}
      {isPdf && <div className="row wrap"><input ref={fileInput} type="file" accept="application/pdf" aria-label="קובץ PDF לחילוץ" onChange={e => { const f = e.target.files?.[0]; if (f) void extract(f) }} />{busy && <span className="small">מחלצים…</span>}</div>}
      <label className="field" style={{ marginTop: 10 }}>הטקסט (אפשר לתקן)<textarea rows={8} value={text} onChange={e => setText(e.target.value)} /></label>
      <button className="btn btn-secondary" onClick={() => run(() => data.saveExtraction(s, d.material.id, text, d.material.pages), 'הטקסט נשמר')}>שמירת הטקסט</button>
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
          <button className="btn btn-small btn-ghost" onClick={() => setTopics(ts => ts.filter((_, j) => j !== i))}>מחיקה</button>
        </fieldset>
      ))}
      {topics.length > 0 && <button className="btn btn-primary" onClick={() => run(() => data.saveTopics(s, d.material.id, topics), 'הנושאים נשמרו')}>שמירת הנושאים</button>}
    </Card>
  )
}

function DraftPreview({ draft }: { draft: ContentDraft }) {
  const pack = draft.pack as { topics?: { name: string; lessons?: { title: string; text: string }[] }[]; pools?: Record<string, { items: { text: string; options?: string[]; answer?: string }[] }> }
  const items = Object.values(pack.pools ?? {}).flatMap(p => p.items)
  return (
    <details className="draft-preview">
      <summary>{pack.topics?.length ?? 0} נושאים · {items.length} שאלות · לצפייה</summary>
      {pack.topics?.map((t, i) => <div key={i}><b>{t.name}</b>{t.lessons?.map((l, j) => <p key={j} className="small">{l.text}</p>)}</div>)}
      <ol className="small">{items.slice(0, 20).map((it, i) => <li key={i}>{it.text.replace('\n', ' – ')}{it.options ? ` [${it.options.join(' / ')}] ✓ ${it.answer}` : ''}</li>)}</ol>
    </details>
  )
}

function ContentStep({ d, run }: { d: MaterialDetail; run: Run }) {
  const data = useData(), s = useSession(), navigate = useNavigate()
  const meta = { subjectName: 'כללי', grade: 'ה' }
  const groups = useAsync(() => (s.role === 'teacher' ? data.myGroups(s) : Promise.resolve([] as Group[])), [data, s.userId])
  const [target, setTarget] = useState('')
  return (
    <Card title="3. תוכן לתרגול (טיוטה ובדיקה)">
      <p className="small muted">כל תוכן נוצר כטיוטה. ילד לא רואה אותו לפני שאישרת.</p>
      <div className="row wrap">
        <button className="btn btn-secondary" disabled={!d.topics.length} onClick={() => run(() => data.createTemplateDraft(s, d.material.id, meta), 'נוצרה טיוטה לפי תבנית')}>יצירה לפי תבנית (ללא AI)</button>
        <button className="btn btn-secondary" disabled={!d.topics.length} onClick={() => run(() => data.requestAiDraft(s, d.material.id, meta), 'נוצרה טיוטה עם AI')}>יצירה עם AI</button>
      </div>
      {d.drafts.length === 0 ? <p className="muted">עוד אין טיוטות.</p> : (
        <ul className="list">{d.drafts.map(dr => (
          <li key={dr.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <span className="row wrap"><Badge tone={dr.provider === 'ai' ? 'info' : 'neutral'}>{dr.provider === 'ai' ? 'נוצר ב-AI' : 'תבנית, ללא AI'}</Badge>
                <span className={`status-pill status-${dr.status === 'approved' ? 'published' : dr.status === 'rejected' ? 'archived' : 'draft'}`}>{dr.status === 'approved' ? 'אושר' : dr.status === 'rejected' ? 'נדחה' : 'ממתין לבדיקה'}</span></span>
              <DraftPreview draft={dr} />
            </div>
            <span className="row wrap">
              {dr.status === 'draft' && <>
                <button className="btn btn-small btn-primary" onClick={() => run(() => data.reviewDraft(s, dr.id, true), 'התוכן אושר')}>אישור</button>
                <button className="btn btn-small btn-secondary" onClick={() => run(() => data.reviewDraft(s, dr.id, false), 'התוכן נדחה')}>דחייה</button>
              </>}
              {dr.status === 'approved' && s.role === 'teacher' && groups.data && groups.data.length > 0 && <>
                <select aria-label="לאיזו קבוצה" value={target} onChange={e => setTarget(e.target.value)}><option value="">קבוצה…</option>{groups.data.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                <button className="btn btn-small btn-primary" disabled={!target} onClick={() => run(async () => { await data.quizFromDraft(s, dr.id, target, `מבחן: ${d.material.title}`); navigate('/teacher/assignments') }, 'נוצר מבחן (טיוטה)')}>יצירת מבחן</button>
              </>}
            </span>
          </li>
        ))}</ul>
      )}
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
