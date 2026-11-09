import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState } from '../components/States'
import { Badge, Card, KIND_TEXT, PageHeader, PersonChip, ProgressBadge, ProgressBar, Stat, formatDate, isDone } from '../components/ui'
import { Loading } from '../components/States'
import { useData } from '../data'
import { GRADES, PLAYER_PATHS, SUBJECTS } from '../data/types'
import type { Grade, Group, PlayerPath, QuizItem, SubjectId } from '../data/types'
import type { AssignmentInput } from '../data/source'
import { useAsync } from '../hooks/useAsync'


export function TeacherHome() {
  const data = useData(), s = useSession()
  const st = useAsync(async () => {
    const [groups, assignments, invitations, materials] = await Promise.all([data.myGroups(s), data.myAssignments(s), data.myInvitations(s), data.myMaterials(s)])
    return { groups, assignments, invitations, materials }
  }, [data, s.userId])
  return (
    <>
      <PageHeader emoji="👋" title={`שלום ${s.fullName.split(' ')[0]}`} subtitle="מה קורה בקבוצות שלך." />
      <AsyncView state={st}>
        {({ groups, assignments, invitations, materials }) => (
          <>
            <div className="stats">
              <Stat emoji="🗂️" label="קבוצות" value={groups.filter(g => !g.archived).length} tone="sky" />
              <Stat emoji="🧒" label="תלמידים" value={new Set(groups.filter(g => !g.archived).flatMap(g => g.studentIds)).size} tone="green" />
              <Stat emoji="✏️" label="משימות פתוחות" value={assignments.length} tone="yellow" />
              <Stat emoji="📨" label="הזמנות ממתינות" value={invitations.filter(i => i.status === 'pending').length} tone="pink" />
            </div>
            <div className="two-col">
              <Card title="משימות קרובות" actions={<Link to="/teacher/assignments" className="link">לכל המשימות</Link>}>
                {assignments.length === 0 ? <EmptyState title="אין משימות פתוחות" /> : (
                  <ul className="list">{[...assignments].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 4).map(a => (
                    <li key={a.id} className="list-row"><span><b>{KIND_TEXT[a.kind].emoji} {a.title}</b><small className="muted block">{a.group.name}</small></span><Badge>עד {formatDate(a.dueAt)}</Badge></li>
                  ))}</ul>
                )}
              </Card>
              <Card title="חומרים שמחכים לבדיקה" actions={<Link to="/teacher/materials" className="link">לחומרים</Link>}>
                {materials.filter(m => m.status === 'ready_for_review').length === 0 ? <EmptyState emoji="✅" title="אין חומרים שמחכים" /> : (
                  <ul className="list">{materials.filter(m => m.status === 'ready_for_review').map(m => (
                    <li key={m.id} className="list-row"><span>📄 {m.title}</span><Badge tone="warn">לבדיקה</Badge></li>
                  ))}</ul>
                )}
              </Card>
            </div>
          </>
        )}
      </AsyncView>
    </>
  )
}

export function TeacherGroups() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.myGroups(s), [data, s.userId])
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader emoji="🗂️" title="הקבוצות שלי" actions={<button className="btn btn-primary" onClick={() => setOpen(o => !o)}>{open ? 'סגירה' : '+ קבוצה חדשה'}</button>} />
      {open && <NewGroupForm onDone={() => { setOpen(false); st.reload() }} />}
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState emoji="🗂️" title="עוד אין לך קבוצות" message="פותחים קבוצה ומזמינים אליה הורים." />}>
        {groups => (
          <div className="grid-cards">{groups.filter(g => !g.archived).map(g => (
            <Link key={g.id} to={`/teacher/groups/${g.id}`} className="card group-card card-link" style={{ borderTopColor: SUBJECTS[g.subject].color }}>
              <h2>{SUBJECTS[g.subject].emoji} {g.name}</h2>
              <p className="row"><Badge>כיתה {g.grade}</Badge><Badge tone="info">{g.studentIds.length} תלמידים</Badge>{g.teacherIds.length > 1 && <Badge>מורה שותפה</Badge>}</p>
            </Link>
          ))}</div>
        )}
      </AsyncView>
    </>
  )
}

function NewGroupForm({ onDone }: { onDone(): void }) {
  const data = useData(), s = useSession()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState<SubjectId>('math')
  const [grade, setGrade] = useState<Grade>('ה')
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    try { await data.createGroup(s, { name, subject, grade }); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <Card title="קבוצה חדשה" className="form-card">
      <form onSubmit={submit} className="form-grid" noValidate>
        <label className="field">שם הקבוצה<input value={name} onChange={e => setName(e.target.value)} placeholder="למשל: חשבון ה׳ – תגבור" /></label>
        <label className="field">מקצוע<select value={subject} onChange={e => setSubject(e.target.value as SubjectId)}>
          {Object.entries(SUBJECTS).map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}</select></label>
        <label className="field">כיתה<select value={grade} onChange={e => setGrade(e.target.value as Grade)}>
          {GRADES.map(g => <option key={g} value={g}>{g === 'גן' ? 'גן חובה' : `כיתה ${g}`}</option>)}</select></label>
        {err && <p className="form-error wide" role="alert">{err}</p>}
        <div className="wide"><button className="btn btn-primary">יצירת הקבוצה</button></div>
      </form>
    </Card>
  )
}

export function GroupDetailPage() {
  const { groupId = '' } = useParams()
  const data = useData(), s = useSession()
  const st = useAsync(() => data.groupDetail(s, groupId), [data, s.userId, groupId])
  return (
    <>
      <Link to="/teacher/groups" className="back-link">→ לכל הקבוצות</Link>
      <AsyncView state={st}>
        {({ group, teachers, students, assignments, progress }) => (
          <>
            <PageHeader emoji={SUBJECTS[group.subject].emoji} title={group.name}
              subtitle={`${SUBJECTS[group.subject].name} · כיתה ${group.grade} · מורים: ${teachers.map(t => t.fullName).join(', ')}`} />
            <Card title="התלמידים והמשימות" actions={<Link className="link" to="/teacher/assignments">+ משימה</Link>}>
              <p className="legend"><span><b>✓ 2/3 ציון</b>: נבדק בשרת (מבחן)</span><span><b>תרגול</b>: דיווח מהתרגול, לא ציון</span></p>
              {students.length === 0 ? <EmptyState emoji="📨" title="עוד אין תלמידים בקבוצה" message="תלמיד מצטרף רק אחרי שהורה מאומת מאשר את ההזמנה." /> : (() => {
                const live = assignments.filter(a => a.status === 'published')
                if (!live.length) return <EmptyState emoji="✏️" title="עוד אין משימות שפורסמו" />
                return (
                  <div className="table-wrap">
                    <table className="matrix">
                      <thead><tr><th scope="col">תלמיד/ה</th>{live.map(a => {
                        const done = students.filter(st => isDone(progress.find(x => x.assignmentId === a.id && x.studentId === st.id))).length
                        return <th key={a.id} scope="col">{KIND_TEXT[a.kind].emoji} {a.title}<small className="block">{Math.round((done / students.length) * 100)}% סיימו</small></th>
                      })}</tr></thead>
                      <tbody>{students.map(st => (
                        <tr key={st.id}>
                          <th scope="row"><PersonChip avatar={st.avatar} name={st.fullName} sub={`כיתה ${st.grade}`} /></th>
                          {live.map(a => <td key={a.id}><ProgressBadge progress={progress.find(x => x.assignmentId === a.id && x.studentId === st.id)} /></td>)}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )
              })()}
            </Card>
            <InviteForm group={group} />
          </>
        )}
      </AsyncView>
    </>
  )
}

function InviteForm({ group }: { group: Group }) {
  const data = useData(), s = useSession()
  const [email, setEmail] = useState('')
  const [child, setChild] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    if (!email.trim() || !child.trim()) { setMsg({ ok: false, text: 'צריך למלא דוא״ל של ההורה ושם פרטי של הילד' }); return }
    try { await data.inviteParent(s, group.id, email, child); setMsg({ ok: true, text: 'ההזמנה נשלחה (בהדגמה). התלמיד יופיע בקבוצה אחרי שההורה יאשר.' }); setEmail(''); setChild('') }
    catch (x) { setMsg({ ok: false, text: (x as Error).message }) }
  }
  return (
    <Card title="הזמנת תלמיד/ה" className="form-card">
      <p className="muted">ההזמנה נשלחת להורה. רק הורה מאומת יכול לאשר, והוא בוחר את הילד (או יוצר לו חשבון). כך לא נוצרים חשבונות כפולים.</p>
      <form onSubmit={submit} className="form-grid" noValidate>
        <label className="field">דוא״ל של ההורה<input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} placeholder="parent@example.org" /></label>
        <label className="field">שם פרטי של הילד<input value={child} onChange={e => setChild(e.target.value)} /></label>
        {msg && <p className={`wide ${msg.ok ? 'form-ok' : 'form-error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        <div className="wide"><button className="btn btn-primary">שליחת הזמנה</button></div>
      </form>
    </Card>
  )
}

export function TeacherStudents() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.myStudents(s), [data, s.userId])
  return (
    <>
      <PageHeader emoji="🧒" title="התלמידים שלי" subtitle="רק תלמידים בקבוצות שלך, שההורים שלהם אישרו." />
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState title="עוד אין תלמידים" message="מזמינים הורים מתוך עמוד הקבוצה." />}>
        {list => (
          <Card><ul className="list">{list.map(x => (
            <li key={x.id} className="list-row"><PersonChip avatar={x.avatar} name={x.fullName} sub={`כיתה ${x.grade}`} />
              <span className="row wrap">{x.groups.map(g => <Badge key={g.id} tone="info">{SUBJECTS[g.subject].emoji} {g.name}</Badge>)}</span></li>
          ))}</ul></Card>
        )}
      </AsyncView>
    </>
  )
}

const STATUS_TEXT = { draft: 'טיוטה', published: 'פורסם', archived: 'בארכיון' } as const

export function TeacherAssignments() {
  const data = useData(), s = useSession()
  const st = useAsync(async () => {
    const groups = (await data.myGroups(s)).filter(g => !g.archived)
    const details = await Promise.all(groups.map(g => data.groupDetail(s, g.id)))
    return { groups, details }
  }, [data, s.userId])
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [msg, setMsg] = useState('')
  async function act(fn: () => Promise<void>, ok: string) {
    setMsg('')
    try { await fn(); setMsg(ok); st.reload() } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <>
      <PageHeader emoji="✏️" title="משימות" subtitle="יוצרים טיוטה, בודקים, ומפרסמים לקבוצה. משימה שפורסמה כבר לא משתנה."
        actions={<button className="btn btn-primary" onClick={() => setEditing(e => (e ? null : 'new'))}>{editing ? 'סגירה' : '+ משימה חדשה'}</button>} />
      {msg && <p className="form-note" role="status">{msg}</p>}
      <AsyncView state={st} isEmpty={d => d.groups.length === 0} empty={<EmptyState title="קודם פותחים קבוצה" />}>
        {({ groups, details }) => {
          const all = details.flatMap(d => d.assignments.map(a => ({ a, d })))
          return (
            <>
              {editing && <AssignmentEditor groups={groups} id={editing === 'new' ? null : editing} onDone={() => { setEditing(null); st.reload() }} />}
              {all.length === 0 ? <EmptyState emoji="✏️" title="עוד אין משימות" /> : (
                <div className="grid-cards">{all.map(({ a, d }) => {
                  const total = d.students.length
                  const done = d.students.filter(x => isDone(d.progress.find(p => p.assignmentId === a.id && p.studentId === x.id))).length
                  return (
                    <Card key={a.id} title={`${KIND_TEXT[a.kind].emoji} ${a.title}`}>
                      <p className="row wrap"><span className={`status-pill status-${a.status}`}>{STATUS_TEXT[a.status]}</span><span className="muted">{d.group.name}{a.dueAt ? ` · עד ${formatDate(a.dueAt)}` : ''}</span></p>
                      {a.status === 'published' && <><ProgressBar value={total ? (done / total) * 100 : 0} label={`השלמה של ${a.title}`} /><p className="small">{done} מתוך {total} סיימו</p></>}
                      <div className="row wrap">
                        {a.status === 'draft' && <>
                          <button className="btn btn-small btn-secondary" onClick={() => setEditing(a.id)}>עריכה</button>
                          <button className="btn btn-small btn-primary" onClick={() => act(() => data.publishAssignment(s, a.id), `"${a.title}" פורסם לקבוצה`)}>פרסום</button>
                        </>}
                        {a.status === 'published' && <button className="btn btn-small btn-secondary" onClick={() => act(() => data.archiveAssignment(s, a.id), 'המשימה הועברה לארכיון')}>לארכיון</button>}
                        <Link className="link" to={`/teacher/groups/${a.groupId}`}>להתקדמות ←</Link>
                      </div>
                    </Card>
                  )
                })}</div>
              )}
            </>
          )
        }}
      </AsyncView>
    </>
  )
}

const emptyItem = (): QuizItem => ({ position: 0, prompt: '', options: ['', ''], answerIndex: undefined })

function AssignmentEditor({ groups, id, onDone }: { groups: Group[]; id: string | null; onDone(): void }) {
  const data = useData(), s = useSession()
  const [f, setF] = useState<AssignmentInput>({ groupId: groups[0]?.id ?? '', title: '', instructions: '', kind: 'practice', playPath: 'math/', dueAt: '', items: [emptyItem()] })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(!!id)
  useEffect(() => {
    if (!id) return
    data.assignmentDetail(s, id).then(a => {
      setF({ groupId: a.groupId, title: a.title, instructions: a.instructions, kind: a.kind, playPath: a.playPath, dueAt: a.dueAt, items: a.items?.length ? a.items : [emptyItem()] })
      setLoading(false)
    }, e => { setErr((e as Error).message); setLoading(false) })
  }, [id, data, s])
  const set = <K extends keyof AssignmentInput>(k: K, v: AssignmentInput[K]) => setF(x => ({ ...x, [k]: v }))
  const setItem = (i: number, patch: Partial<QuizItem>) => set('items', (f.items ?? []).map((it, j) => (j === i ? { ...it, ...patch } : it)))
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (!f.title.trim()) return setErr('צריך כותרת')
    const items = f.kind === 'quiz' ? (f.items ?? []).map(it => ({ ...it, prompt: it.prompt.trim(), options: it.options.map(o => o.trim()).filter(Boolean) })) : undefined
    if (items && (items.length === 0 || items.some(it => !it.prompt || it.options.length < 2 || it.answerIndex === undefined || it.answerIndex >= it.options.length))) {
      return setErr('בכל שאלה: ניסוח, לפחות שתי תשובות, וסימון התשובה הנכונה')
    }
    const input = { ...f, items, dueAt: f.dueAt || undefined }
    try { if (id) await data.updateAssignment(s, id, input); else await data.createAssignment(s, input); onDone() } catch (x) { setErr((x as Error).message) }
  }
  if (loading) return <Loading />
  return (
    <Card title={id ? 'עריכת טיוטה' : 'משימה חדשה (טיוטה)'} className="form-card">
      <form onSubmit={submit} className="form-grid" noValidate>
        <label className="field">קבוצה<select value={f.groupId} onChange={e => set('groupId', e.target.value)} disabled={!!id}>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <label className="field">סוג<select value={f.kind} onChange={e => set('kind', e.target.value as AssignmentInput['kind'])}>
          <option value="practice">תרגול במשחק</option><option value="quiz">מבחן (נבדק בשרת)</option><option value="reading">קריאה</option></select></label>
        <label className="field wide">כותרת<input value={f.title} onChange={e => set('title', e.target.value)} maxLength={120} /></label>
        <label className="field wide">הנחיות (מוקראות לתלמיד)<textarea rows={2} value={f.instructions} maxLength={1000} onChange={e => set('instructions', e.target.value)} /></label>
        {f.kind === 'practice' && <label className="field">מתרגלים ב<select value={f.playPath} onChange={e => set('playPath', e.target.value as PlayerPath)}>
          {Object.entries(PLAYER_PATHS).map(([p, n]) => <option key={p} value={p}>{n}</option>)}</select></label>}
        <label className="field">תאריך יעד (לא חובה)<input type="date" value={f.dueAt ?? ''} onChange={e => set('dueAt', e.target.value)} /></label>
        {f.kind === 'quiz' && (
          <div className="wide quiz-editor">
            <b>שאלות</b> <span className="small muted">התשובה הנכונה נשמרת בשרת בלבד. תלמידים והורים לא רואים אותה.</span>
            {(f.items ?? []).map((it, i) => (
              <fieldset key={i} className="q-row">
                <legend className="small">שאלה {i + 1}</legend>
                <input aria-label={`ניסוח שאלה ${i + 1}`} value={it.prompt} onChange={e => setItem(i, { prompt: e.target.value })} placeholder="מה שואלים?" style={{ width: '100%' }} />
                {it.options.map((o, j) => (
                  <div key={j} className="opt-row">
                    <input type="radio" name={`ans${i}`} aria-label={`תשובה ${j + 1} נכונה`} checked={it.answerIndex === j} onChange={() => setItem(i, { answerIndex: j })} />
                    <input type="text" aria-label={`שאלה ${i + 1} תשובה ${j + 1}`} value={o} onChange={e => setItem(i, { options: it.options.map((x, k) => (k === j ? e.target.value : x)) })} />
                  </div>
                ))}
                <div className="row wrap" style={{ marginTop: 6 }}>
                  {it.options.length < 6 && <button type="button" className="btn btn-small btn-ghost" onClick={() => setItem(i, { options: [...it.options, ''] })}>+ תשובה</button>}
                  {(f.items ?? []).length > 1 && <button type="button" className="btn btn-small btn-ghost" onClick={() => set('items', (f.items ?? []).filter((_, k) => k !== i))}>מחיקת שאלה</button>}
                </div>
              </fieldset>
            ))}
            {(f.items ?? []).length < 50 && <button type="button" className="btn btn-small btn-secondary" onClick={() => set('items', [...(f.items ?? []), emptyItem()])}>+ שאלה</button>}
          </div>
        )}
        {err && <p className="form-error wide" role="alert">{err}</p>}
        <div className="wide"><button className="btn btn-primary">{id ? 'שמירת הטיוטה' : 'שמירה כטיוטה'}</button></div>
      </form>
    </Card>
  )
}

export { MaterialsPage as TeacherMaterials } from './materials'
