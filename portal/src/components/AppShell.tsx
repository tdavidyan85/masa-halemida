import { NavLink, Outlet, useNavigate } from 'react-router'
import { ROLE_NAME, useAuth } from '../auth/AuthContext'
import type { Role } from '../data/types'
import { Avatar } from './ui'

export interface NavItem { to: string; label: string; emoji: string; end?: boolean }

export const NAV: Record<Role, NavItem[]> = {
  admin: [
    { to: '/admin', label: 'סקירה', emoji: '🏠', end: true },
    { to: '/admin/users', label: 'משתמשים', emoji: '👥' },
    { to: '/admin/teachers', label: 'מורים', emoji: '🧑‍🏫' },
    { to: '/admin/groups', label: 'קבוצות', emoji: '🗂️' },
  ],
  teacher: [
    { to: '/teacher', label: 'ראשי', emoji: '🏠', end: true },
    { to: '/teacher/groups', label: 'קבוצות', emoji: '🗂️' },
    { to: '/teacher/students', label: 'תלמידים', emoji: '🧒' },
    { to: '/teacher/assignments', label: 'משימות', emoji: '✏️' },
    { to: '/teacher/materials', label: 'חומרי לימוד', emoji: '📄' },
  ],
  parent: [
    { to: '/parent', label: 'הילדים שלי', emoji: '🏠', end: true },
    { to: '/parent/approvals', label: 'אישורים', emoji: '✅' },
    { to: '/parent/progress', label: 'התקדמות', emoji: '📈' },
    { to: '/parent/settings', label: 'הגדרות', emoji: '⚙️' },
  ],
  student: [
    { to: '/student', label: 'היום', emoji: '☀️', end: true },
    { to: '/student/tasks', label: 'משימות', emoji: '🎯' },
    { to: '/student/tests', label: 'מבחנים', emoji: '📝' },
    { to: '/student/progress', label: 'ההתקדמות שלי', emoji: '⭐' },
  ],
}

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <b>מצב הדגמה.</b> כל השמות והתמונות פיקטיביים. אין כאן התחברות אמיתית או הרשאות מאובטחות, ושום דבר לא נשמר בשרת.
    </div>
  )
}

export function AppShell({ role }: { role: Role }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const items = NAV[role]
  return (
    <div className={`shell shell-${role}`}>
      <DemoBanner />
      <header className="topbar">
        <div className="brand"><span aria-hidden>🦉</span> מסע הלמידה <small>· {ROLE_NAME[role]}</small></div>
        {session && (
          <div className="row user-box">
            <Avatar src={session.avatar} name={session.fullName} size={38} />
            <span className="user-name">{session.fullName}</span>
            <button className="btn btn-ghost" onClick={() => { signOut(); navigate(role === 'student' ? '/login/student' : '/login') }}>יציאה</button>
          </div>
        )}
      </header>
      <div className="shell-body">
        <nav className="sidenav" aria-label="ניווט ראשי">
          {items.map(i => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <span aria-hidden className="nav-emoji">{i.emoji}</span><span className="nav-label">{i.label}</span>
            </NavLink>
          ))}
        </nav>
        <main className="content" id="main"><Outlet /></main>
      </div>
    </div>
  )
}
