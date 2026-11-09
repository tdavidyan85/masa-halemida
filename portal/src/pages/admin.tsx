import { useMemo, useState } from 'react'
import { useSession, ROLE_NAME } from '../auth/AuthContext'
import { AsyncView, EmptyState } from '../components/States'
import { Badge, Card, PageHeader, PersonChip, Stat } from '../components/ui'
import { useData } from '../data'
import { SUBJECTS } from '../data/types'
import type { Adult, Role } from '../data/types'
import { useAsync } from '../hooks/useAsync'

const STATUS: Record<Adult['status'], [string, 'good' | 'warn' | 'bad']> = { active: ['פעיל', 'good'], pending: ['ממתין לאישור', 'warn'], suspended: ['מושעה', 'bad'] }

function useAdminData() {
  const data = useData(), s = useSession()
  return useAsync(async () => {
    const [adults, students, groups] = await Promise.all([data.listAdults(s), data.listStudents(s), data.listGroups(s)])
    return { adults, students, groups }
  }, [data, s.userId])
}

export function AdminHome() {
  const st = useAdminData()
  return (
    <>
      <PageHeader emoji="🛡️" title="ניהול המערכת" subtitle="תמונת מצב של המשתמשים והקבוצות." />
      <AsyncView state={st}>
        {({ adults, students, groups }) => {
          const pending = adults.filter(a => a.status === 'pending')
          return (
            <>
              <div className="stats">
                <Stat emoji="🧑‍🏫" label="מורים" value={adults.filter(a => a.role === 'teacher').length} tone="sky" />
                <Stat emoji="👪" label="הורים" value={adults.filter(a => a.role === 'parent').length} tone="pink" />
                <Stat emoji="🎒" label="תלמידים" value={students.length} tone="green" />
                <Stat emoji="🗂️" label="קבוצות פעילות" value={groups.filter(g => !g.archived).length} tone="yellow" />
              </div>
              <Card title="ממתינים לאישור">
                {pending.length === 0 ? <EmptyState emoji="✨" title="אין בקשות שממתינות" /> : (
                  <ul className="list">{pending.map(a => (
                    <li key={a.id} className="list-row"><PersonChip avatar={a.avatar} name={a.fullName} sub={`${ROLE_NAME[a.role]} · ${a.email}`} /><Badge tone="warn">ממתין</Badge></li>
                  ))}</ul>
                )}
              </Card>
            </>
          )
        }}
      </AsyncView>
    </>
  )
}

export function AdminUsers() {
  const st = useAdminData()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role | 'all'>('all')
  return (
    <>
      <PageHeader emoji="👥" title="משתמשים" subtitle="כל המבוגרים והתלמידים במערכת." />
      <div className="filters">
        <input className="search" placeholder="חיפוש לפי שם…" value={q} onChange={e => setQ(e.target.value)} aria-label="חיפוש לפי שם" />
        <select value={role} onChange={e => setRole(e.target.value as Role | 'all')} aria-label="סינון לפי תפקיד">
          <option value="all">כל התפקידים</option>
          {(['admin', 'teacher', 'parent', 'student'] as Role[]).map(r => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
        </select>
      </div>
      <AsyncView state={st}>
        {({ adults, students }) => {
          const all = [
            ...adults.map(a => ({ id: a.id, role: a.role, name: a.fullName, avatar: a.avatar, sub: a.email, status: a.status })),
            ...students.map(x => ({ id: x.id, role: x.role, name: x.fullName, avatar: x.avatar, sub: `כיתה ${x.grade} · ${x.loginMode === 'pin' ? 'כניסה בקוד' : 'שם משתמש'}`, status: x.status })),
          ].filter(u => (role === 'all' || u.role === role) && u.name.includes(q.trim()))
          if (!all.length) return <EmptyState emoji="🔍" title="לא נמצאו משתמשים" message="נסו חיפוש אחר או תפקיד אחר." />
          return (
            <Card>
              <ul className="list">{all.map(u => (
                <li key={u.id} className="list-row">
                  <PersonChip avatar={u.avatar} name={u.name} sub={u.sub} />
                  <span className="row"><Badge tone="info">{ROLE_NAME[u.role]}</Badge><Badge tone={STATUS[u.status][1]}>{STATUS[u.status][0]}</Badge></span>
                </li>
              ))}</ul>
            </Card>
          )
        }}
      </AsyncView>
    </>
  )
}

export function AdminTeachers() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.listAdults(s), [data, s.userId])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function setStatus(id: string, status: Adult['status']) {
    setBusy(id); setErr('')
    try { await data.setAdultStatus(s, id, status); st.reload() } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  return (
    <>
      <PageHeader emoji="🧑‍🏫" title="מורים" subtitle="מורה חדשה נכנסת רק אחרי אישור של מנהל/ת המערכת." />
      {err && <p className="form-error" role="alert">{err}</p>}
      <AsyncView state={st} isEmpty={l => !l.some(a => a.role === 'teacher')}>
        {list => (
          <Card>
            <ul className="list">{list.filter(a => a.role === 'teacher').map(t => (
              <li key={t.id} className="list-row">
                <PersonChip avatar={t.avatar} name={t.fullName} sub={t.email} />
                <span className="row">
                  <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
                  {t.status !== 'active' && <button className="btn btn-small btn-primary" disabled={busy === t.id} onClick={() => setStatus(t.id, 'active')}>אישור</button>}
                  {t.status === 'active' && <button className="btn btn-small btn-secondary" disabled={busy === t.id} onClick={() => setStatus(t.id, 'suspended')}>השעיה</button>}
                </span>
              </li>
            ))}</ul>
          </Card>
        )}
      </AsyncView>
    </>
  )
}

export function AdminGroups() {
  const st = useAdminData()
  const [showArchived, setShowArchived] = useState(false)
  return (
    <>
      <PageHeader emoji="🗂️" title="קבוצות" subtitle="כל הקבוצות במערכת והמורים שלהן."
        actions={<label className="check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> להציג ארכיון</label>} />
      <AsyncView state={st}>
        {({ groups, adults }) => <GroupGrid groups={groups.filter(g => showArchived || !g.archived)} adults={adults} />}
      </AsyncView>
    </>
  )
}

function GroupGrid({ groups, adults }: { groups: import('../data/types').Group[]; adults: Adult[] }) {
  const byId = useMemo(() => new Map(adults.map(a => [a.id, a])), [adults])
  if (!groups.length) return <EmptyState title="אין קבוצות" />
  return (
    <div className="grid-cards">{groups.map(g => (
      <Card key={g.id} className="group-card" title={g.name}>
        <p className="row"><Badge tone="info">{SUBJECTS[g.subject].emoji} {SUBJECTS[g.subject].name}</Badge><Badge>כיתה {g.grade}</Badge>{g.archived && <Badge tone="warn">ארכיון</Badge>}</p>
        <p className="muted">{g.studentIds.length} תלמידים · מורים: {g.teacherIds.map(id => byId.get(id)?.fullName ?? '?').join(', ')}</p>
      </Card>
    ))}</div>
  )
}
