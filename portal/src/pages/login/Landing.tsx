import { Link, Navigate } from 'react-router'
import { HOME_OF, useAuth } from '../../auth/AuthContext'
import { DemoBanner } from '../../components/AppShell'

export default function Landing() {
  const { session } = useAuth()
  if (session) return <Navigate to={HOME_OF[session.role]} replace />
  return (
    <div className="auth-page">
      <DemoBanner />
      <main className="landing">
        <div className="landing-hero">
          <div className="owl" aria-hidden>🦉</div>
          <h1>מסע הלמידה</h1>
          <p>לומדים, מתרגלים ומתקדמים, כל אחד בקצב שלו.</p>
        </div>
        <div className="landing-choices">
          <Link to="/login/student" className="choice choice-student">
            <span className="choice-emoji" aria-hidden>🎒</span>
            <b>אני תלמיד/ה</b>
            <span>כניסה עם תמונה וקוד, או עם שם משתמש</span>
          </Link>
          <Link to="/login" className="choice choice-adult">
            <span className="choice-emoji" aria-hidden>🧑‍🏫</span>
            <b>אני מבוגר/ת</b>
            <span>הורה, מורה או מנהל/ת מערכת</span>
          </Link>
        </div>
      </main>
    </div>
  )
}
