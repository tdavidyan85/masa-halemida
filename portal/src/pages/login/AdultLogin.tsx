import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { HOME_OF, useAuth } from '../../auth/AuthContext'
import { DemoBanner } from '../../components/AppShell'
import { useData } from '../../data'
import { DEMO_PASSWORD } from '../../data/mockData'

const SAMPLES = [
  { email: 'admin@demo.local', label: 'מנהלת מערכת', emoji: '🛡️' },
  { email: 'michal@demo.local', label: 'מורה', emoji: '🧑‍🏫' },
  { email: 'ronit@demo.local', label: 'הורה', emoji: '👪' },
  { email: 'yael@demo.local', label: 'מורה שממתינה לאישור', emoji: '⏳' },
]

export default function AdultLogin() {
  const data = useData()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) { setError('צריך למלא דוא״ל וסיסמה'); return }
    setBusy(true)
    try {
      const s = await data.signInAdult(email, password)
      signIn(s)
      navigate(from && from.startsWith(HOME_OF[s.role]) ? from : HOME_OF[s.role], { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הכניסה נכשלה')
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-page">
      <DemoBanner />
      <main className="auth-card">
        <Link to="/" className="back-link">→ חזרה</Link>
        <h1>כניסה למבוגרים</h1>
        <p className="muted">הורים, מורים ומנהלי מערכת.</p>
        <form onSubmit={submit} noValidate>
          <label className="field">דוא״ל
            <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" />
          </label>
          <label className="field">סיסמה
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'נכנסים…' : 'כניסה'}</button>
        </form>
        <p className="row wrap small auth-links"><Link to="/forgot-password">שכחתי סיסמה</Link><span aria-hidden>·</span><Link to="/signup">אין לי חשבון: הרשמה</Link></p>
        {data.kind === 'mock' && <div className="demo-box">
          <b>חשבונות לדוגמה</b> (סיסמה: <code dir="ltr">{DEMO_PASSWORD}</code>)
          <div className="sample-grid">
            {SAMPLES.map(s => (
              <button key={s.email} type="button" className="sample" onClick={() => { setEmail(s.email); setPassword(DEMO_PASSWORD); setError('') }}>
                <span aria-hidden>{s.emoji}</span> {s.label}
              </button>
            ))}
          </div>
        </div>}
      </main>
    </div>
  )
}
