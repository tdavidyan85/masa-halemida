import { useState } from 'react'
import { Link } from 'react-router'
import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState } from '../components/States'
import { Avatar, Badge, Card, KIND_TEXT, PageHeader, PersonChip, ProgressBadge, ProgressBar, formatDate } from '../components/ui'
import { useData } from '../data'
import { SUBJECTS } from '../data/types'
import type { ChildOverview } from '../data/source'
import { useAsync } from '../hooks/useAsync'

function useChildren() {
  const data = useData(), s = useSession()
  return useAsync(() => data.myChildren(s), [data, s.userId])
}
const noKids = <EmptyState emoji="👶" title="עוד לא הוספת ילדים" message="בגרסה המלאה יוצרים כאן חשבון לילד." />

export function ParentHome() {
  const st = useChildren(), s = useSession()
  return (
    <>
      <PageHeader emoji="👪" title={`שלום ${s.fullName.split(' ')[0]}`} subtitle="הילדים שלך והמשימות שלהם." />
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={noKids}>
        {kids => (
          <div className="grid-cards">{kids.map(k => <ChildCard key={k.student.id} k={k} />)}</div>
        )}
      </AsyncView>
    </>
  )
}

function ChildCard({ k }: { k: ChildOverview }) {
  const open = k.assignments.filter(a => a.progress?.state !== 'done')
  return (
    <Card className="child-card">
      <div className="child-head">
        <Avatar src={k.student.avatar} name={k.student.fullName} size={72} />
        <div><h2>{k.student.fullName}</h2><p className="muted">כיתה {k.student.grade} · {k.student.loginMode === 'pin' ? 'נכנס/ת עם קוד' : `שם משתמש: ${k.student.username}`}</p></div>
      </div>
      <p className="row wrap">{k.groups.length ? k.groups.map(g => <Badge key={g.id} tone="info">{SUBJECTS[g.subject].emoji} {g.name}</Badge>) : <span className="muted">עוד לא בקבוצה</span>}</p>
      <p><b>{open.length}</b> משימות פתוחות{open[0] ? ` · הקרובה: ${open[0].title} (עד ${formatDate(open[0].dueAt)})` : ''}</p>
      <Link to="/parent/progress" className="link">להתקדמות המלאה ←</Link>
    </Card>
  )
}

export function ParentApprovals() {
  const data = useData(), s = useSession()
  const st = useAsync(async () => {
    const [invitations, kids] = await Promise.all([data.parentInvitations(s), data.myChildren(s)])
    return { invitations, kids }
  }, [data, s.userId])
  return (
    <>
      <PageHeader emoji="✅" title="אישורים" subtitle="מורה הזמינה את הילד/ה לקבוצה? רק את/ה מחליט/ה." />
      <AsyncView state={st}>
        {({ invitations, kids }) => {
          const pending = invitations.filter(i => i.status === 'pending')
          const past = invitations.filter(i => i.status !== 'pending')
          return (
            <>
              <Card title="ממתינות לאישור שלך">
                {pending.length === 0 ? <EmptyState emoji="📭" title="אין הזמנות חדשות" /> : pending.map(i => (
                  <InvitationRow key={i.id} inv={i} kids={kids} onDone={st.reload} />
                ))}
              </Card>
              {past.length > 0 && (
                <Card title="היסטוריה">
                  <ul className="list">{past.map(i => (
                    <li key={i.id} className="list-row"><span>{i.group.name} · {i.teacher.fullName}</span>
                      <Badge tone={i.status === 'approved' ? 'good' : i.status === 'declined' ? 'bad' : 'neutral'}>{i.status === 'approved' ? 'אושרה' : i.status === 'declined' ? 'נדחתה' : 'פג תוקף'}</Badge></li>
                  ))}</ul>
                </Card>
              )}
            </>
          )
        }}
      </AsyncView>
    </>
  )
}

function InvitationRow({ inv, kids, onDone }: { inv: Awaited<ReturnType<ReturnType<typeof useData>['parentInvitations']>>[number]; kids: ChildOverview[]; onDone(): void }) {
  const data = useData(), s = useSession()
  const guess = kids.find(k => k.student.fullName.startsWith(inv.childHint))
  const [child, setChild] = useState(guess?.student.id ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function respond(approve: boolean) {
    setErr('')
    if (approve && !child) { setErr('צריך לבחור איזה ילד מצטרף'); return }
    setBusy(true)
    try { await data.respondInvitation(s, inv.id, approve, approve ? child : undefined); onDone() } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="invite">
      <PersonChip avatar={inv.teacher.avatar} name={inv.teacher.fullName} sub={`מזמינה את "${inv.childHint}" לקבוצה: ${inv.group.name}`} />
      <div className="consent-box">
        <b>מה המורה תראה אם תאשרו:</b>
        <ul><li>שם מלא, כיתה ותמונת פרופיל של הילד</li><li>ההתקדמות במשימות של הקבוצה הזאת בלבד</li></ul>
        <span className="small muted">בגרסה המלאה אפשר יהיה לבטל את האישור בכל רגע, והגישה של המורה תיעצר מיד. בהדגמה הביטול עוד לא פעיל.</span>
      </div>
      <div className="row wrap">
        <label className="field inline">איזה ילד?
          <select value={child} onChange={e => setChild(e.target.value)}>
            <option value="">בחירה…</option>
            {kids.map(k => <option key={k.student.id} value={k.student.id}>{k.student.fullName}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={() => respond(true)}>אישור והצטרפות</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => respond(false)}>לא, תודה</button>
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  )
}

export function ParentProgress() {
  const st = useChildren()
  return (
    <>
      <PageHeader emoji="📈" title="התקדמות" subtitle="בכל המקצועות, לכל ילד." />
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={noKids}>
        {kids => kids.map(k => (
          <Card key={k.student.id} title={k.student.fullName} actions={<Avatar src={k.student.avatar} name={k.student.fullName} size={44} />}>
            {k.subjects.length === 0 ? <EmptyState emoji="🌱" title="עוד אין נתוני תרגול" /> : (
              <div className="subject-grid">{k.subjects.map(sp => (
                <div key={sp.subject} className="subject-tile" style={{ borderColor: SUBJECTS[sp.subject].color }}>
                  <h3>{SUBJECTS[sp.subject].emoji} {SUBJECTS[sp.subject].name}</h3>
                  <ProgressBar value={sp.firstTry} label={`נכון מהפעם הראשונה ב${SUBJECTS[sp.subject].name}`} />
                  <p className="small">{sp.firstTry}% נכון מהפעם הראשונה · {sp.questions} שאלות · {sp.daysActive} ימי תרגול</p>
                  {sp.strong.length > 0 && <p className="small">💪 חזק ב: {sp.strong.join(', ')}</p>}
                  {sp.needsWork.length > 0 && <p className="small">🎯 כדאי לחזק: {sp.needsWork.join(', ')}</p>}
                </div>
              ))}</div>
            )}
            {k.assignments.length > 0 && (
              <ul className="list">{k.assignments.map(a => (
                <li key={a.id} className="list-row"><span>{KIND_TEXT[a.kind].emoji} {a.title}</span><ProgressBadge state={a.progress?.state} score={a.progress?.score} /></li>
              ))}</ul>
            )}
          </Card>
        ))}
      </AsyncView>
    </>
  )
}

export function ParentSettings() {
  const st = useChildren()
  const data = useData(), s = useSession()
  const [note, setNote] = useState('')
  async function release(id: string, name: string) {
    try { await data.releaseLock(s, id); setNote(`החשבון של ${name} שוחרר (בהדגמה).`) } catch (x) { setNote((x as Error).message) }
  }
  return (
    <>
      <PageHeader emoji="⚙️" title="הגדרות" subtitle="כניסה של הילדים, אישורים ופרטיות." />
      {note && <p className="form-ok" role="status">{note}</p>}
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={noKids}>
        {kids => kids.map(k => (
          <Card key={k.student.id} title={k.student.fullName} actions={<Avatar src={k.student.avatar} name={k.student.fullName} size={44} />}>
            <div className="settings-grid">
              <div><b>כניסה</b><p className="muted">{k.student.loginMode === 'pin' ? 'תמונה וקוד בן 6 ספרות (רק ממכשיר מאושר)' : `שם משתמש: ${k.student.username}`}</p>
                <div className="row wrap">
                  <button className="btn btn-small btn-secondary" disabled title="יופעל כשיהיה שרת">{k.student.loginMode === 'pin' ? 'קוד חדש' : 'סיסמה חדשה'}</button>
                  <button className="btn btn-small btn-secondary" onClick={() => release(k.student.id, k.student.fullName)}>שחרור נעילה</button>
                </div>
              </div>
              <div><b>אישורים פעילים</b>
                <ul className="small">{k.consents.filter(c => !c.revokedAt).map(c => (
                  <li key={c.id}>{c.scope === 'group' ? `הצטרפות לקבוצה (${k.groups.find(g => g.id === c.groupId)?.name ?? 'קבוצה'})` : c.scope === 'photo' ? 'הצגת תמונת פרופיל למורים' : 'עיבוד חומרים ב-AI'} · מ-{formatDate(c.grantedAt)}</li>
                ))}</ul>
                <p className="small muted">ביטול אישור יתאפשר כשיהיה שרת.</p>
              </div>
            </div>
          </Card>
        ))}
      </AsyncView>
    </>
  )
}
