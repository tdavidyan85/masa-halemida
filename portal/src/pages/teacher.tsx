import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState } from '../components/States'
import { Badge, Card, KIND_TEXT, PageHeader, PersonChip, ProgressBadge, ProgressBar, Stat, formatDate } from '../components/ui'
import { useData } from '../data'
import { GRADES, SUBJECTS } from '../data/types'
import type { Grade, Group, SubjectId } from '../data/types'
import { useAsync } from '../hooks/useAsync'

const MATERIAL_STATUS = {
  uploaded: ['הועלה', 'neutral'], processing: ['בעיבוד', 'info'], ready_for_review: ['מחכה לבדיקה שלך', 'warn'], approved: ['מאושר', 'good'],
} as const

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
            <Card title="התלמידים והמשימות">
              {students.length === 0 ? <EmptyState emoji="📨" title="עוד אין תלמידים בקבוצה" message="תלמיד מצטרף רק אחרי שהורה מאומת מאשר את ההזמנה." /> : (
                <div className="table-wrap">
                  <table className="matrix">
                    <thead><tr><th scope="col">תלמיד/ה</th>{assignments.map(a => <th key={a.id} scope="col">{KIND_TEXT[a.kind].emoji} {a.title}</th>)}</tr></thead>
                    <tbody>{students.map(st => (
                      <tr key={st.id}>
                        <th scope="row"><PersonChip avatar={st.avatar} name={st.fullName} sub={`כיתה ${st.grade}`} /></th>
                        {assignments.map(a => { const p = progress.find(x => x.assignmentId === a.id && x.studentId === st.id); return <td key={a.id}><ProgressBadge state={p?.state} score={p?.score} /></td> })}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
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
        <label className="field">דוא״ל של ההורה<input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} placeholder="ronit@demo.local" /></label>
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

export function TeacherAssignments() {
  const data = useData(), s = useSession()
  const st = useAsync(async () => {
    const [assignments, groups] = await Promise.all([data.myAssignments(s), data.myGroups(s)])
    const details = await Promise.all(groups.filter(g => !g.archived).map(g => data.groupDetail(s, g.id)))
    return { assignments, details }
  }, [data, s.userId])
  return (
    <>
      <PageHeader emoji="✏️" title="משימות" subtitle="כמה מהקבוצה כבר השלימו כל משימה." />
      <AsyncView state={st} isEmpty={d => d.assignments.length === 0} empty={<EmptyState title="אין משימות" />}>
        {({ assignments, details }) => (
          <div className="grid-cards">{assignments.map(a => {
            const d = details.find(x => x.group.id === a.groupId)
            const total = d?.students.length ?? 0
            const done = d?.progress.filter(p => p.assignmentId === a.id && p.state === 'done').length ?? 0
            return (
              <Card key={a.id} title={`${KIND_TEXT[a.kind].emoji} ${a.title}`}>
                <p className="muted">{a.group.name} · עד {formatDate(a.dueAt)}</p>
                <ProgressBar value={total ? (done / total) * 100 : 0} label={`השלמה של ${a.title}`} />
                <p className="small">{done} מתוך {total} השלימו</p>
              </Card>
            )
          })}</div>
        )}
      </AsyncView>
    </>
  )
}

export function TeacherMaterials() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.myMaterials(s), [data, s.userId])
  return (
    <>
      <PageHeader emoji="📄" title="חומרי לימוד" subtitle="מעלים דף עבודה או PDF, ה-AI מכין ממנו יחידת תרגול, ואת/ה בודק/ת ומאשר/ת לפני שתלמיד רואה." />
      <div className="dropzone" aria-disabled="true">
        <span aria-hidden>📤</span>
        <b>העלאת קובץ</b>
        <span className="muted">עדיין לא פעיל בהדגמה: לא מעלים כאן קבצים, ושום דבר לא נשלח ל-AI.</span>
      </div>
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState emoji="📄" title="עוד לא העלית חומרים" />}>
        {list => (
          <Card><ul className="list">{list.map(m => (
            <li key={m.id} className="list-row"><span><b>📄 {m.title}</b><small className="muted block" dir="ltr">{m.fileName} · {m.pages} עמ׳</small></span>
              <Badge tone={MATERIAL_STATUS[m.status][1]}>{MATERIAL_STATUS[m.status][0]}</Badge></li>
          ))}</ul></Card>
        )}
      </AsyncView>
    </>
  )
}
