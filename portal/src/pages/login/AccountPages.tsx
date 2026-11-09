// Adult account pages: sign-up, forgot password, choose a new password (after the e-mail link).
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { HOME_OF, useAuth } from '../../auth/AuthContext'
import { DemoBanner } from '../../components/AppShell'
import { useData } from '../../data'
import { DemoOnlyError } from '../../data/source'

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <DemoBanner />
      <main className="auth-card">
        <Link to="/login" className="back-link">→ לכניסה</Link>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </main>
    </div>
  )
}

function Notice({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return <p className={error instanceof DemoOnlyError ? 'form-note' : 'form-error'} role="alert">{msg}</p>
}

export function SignUp() {
  const data = useData()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'parent' | 'teacher'>('parent')
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState<null | { needsEmailConfirmation: boolean }>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (fullName.trim().length < 2) return setError(new Error('צריך שם מלא'))
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(new Error('כתובת הדוא״ל לא תקינה'))
    if (password.length < 8) return setError(new Error('הסיסמה צריכה לפחות 8 תווים'))
    setBusy(true)
    try { setDone(await data.signUpAdult({ fullName, email, password, role })) } catch (x) { setError(x) } finally { setBusy(false) }
  }
  if (done) {
    return (
      <AuthCard title="כמעט סיימנו">
        <p className="form-ok" role="status">
          {done.needsEmailConfirmation ? 'שלחנו קישור לאישור לכתובת הדוא״ל. אחרי האישור אפשר להיכנס.' : 'החשבון נוצר.'}
          {role === 'teacher' && ' חשבון מורה נפתח אחרי אישור של מנהל/ת המערכת.'}
        </p>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="הרשמה" subtitle="להורים ולמורים. תלמידים מקבלים חשבון מההורה.">
      <form onSubmit={submit} noValidate>
        <label className="field">שם מלא<input autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} /></label>
        <label className="field">דוא״ל<input type="email" dir="ltr" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="field">סיסמה (לפחות 8 תווים)<input type="password" dir="ltr" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <fieldset className="field radio-row">
          <legend>אני</legend>
          <label className="check"><input type="radio" name="role" checked={role === 'parent'} onChange={() => setRole('parent')} /> הורה</label>
          <label className="check"><input type="radio" name="role" checked={role === 'teacher'} onChange={() => setRole('teacher')} /> מורה (דורש אישור מנהל/ת)</label>
        </fieldset>
        <Notice error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'שולחים…' : 'הרשמה'}</button>
      </form>
    </AuthCard>
  )
}

export function ForgotPassword() {
  const data = useData()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [sent, setSent] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(new Error('כתובת הדוא״ל לא תקינה'))
    try { await data.requestPasswordReset(email); setSent(true) } catch (x) { setError(x) }
  }
  return (
    <AuthCard title="שכחתי סיסמה" subtitle="נשלח קישור לבחירת סיסמה חדשה.">
      {sent ? <p className="form-ok" role="status">אם יש חשבון עם הכתובת הזאת, שלחנו אליה קישור. הקישור תקף לזמן קצר.</p> : (
        <form onSubmit={submit} noValidate>
          <label className="field">דוא״ל<input type="email" dir="ltr" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <Notice error={error} />
          <button className="btn btn-primary btn-block">שליחת קישור</button>
          <p className="small muted">תלמידים: רק הורה יכול להחליף קוד או סיסמה של ילד.</p>
        </form>
      )}
    </AuthCard>
  )
}

export function ResetPassword() {
  const data = useData()
  const { session, recovery, clearRecovery } = useAuth()
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)
  useEffect(() => () => clearRecovery(), [clearRecovery])
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (pw.length < 8) return setError(new Error('הסיסמה צריכה לפחות 8 תווים'))
    if (pw !== pw2) return setError(new Error('שתי הסיסמאות לא זהות'))
    try { await data.updatePassword(pw); setDone(true) } catch (x) { setError(x) }
  }
  if (!recovery && !session) {
    return <AuthCard title="בחירת סיסמה חדשה"><p className="form-error" role="alert">הקישור לא תקף או שפג תוקפו. בקשו קישור חדש מ"שכחתי סיסמה".</p></AuthCard>
  }
  return (
    <AuthCard title="בחירת סיסמה חדשה">
      {done ? (
        <>
          <p className="form-ok" role="status">הסיסמה עודכנה.</p>
          {session && <button className="btn btn-primary" onClick={() => navigate(HOME_OF[session.role], { replace: true })}>להמשיך</button>}
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <label className="field">סיסמה חדשה<input type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
          <label className="field">שוב, לאימות<input type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></label>
          <Notice error={error} />
          <button className="btn btn-primary btn-block">שמירה</button>
        </form>
      )}
    </AuthCard>
  )
}
