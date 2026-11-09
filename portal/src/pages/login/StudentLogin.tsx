import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthContext'
import { DemoBanner } from '../../components/AppShell'
import { AsyncView } from '../../components/States'
import { Avatar } from '../../components/ui'
import { useData } from '../../data'
import { DEMO_PASSWORD, DEMO_PIN } from '../../data/mockData'
import { LoginError } from '../../data/source'
import type { PinProfile } from '../../data/source'
import { useAsync } from '../../hooks/useAsync'

const PIN_LEN = 6

export default function StudentLogin() {
  const [mode, setMode] = useState<'pin' | 'password'>('pin')
  return (
    <div className="auth-page auth-kids">
      <DemoBanner />
      <main className="auth-card auth-card-wide">
        <Link to="/" className="back-link">→ חזרה</Link>
        <h1>שלום! מי נכנס?</h1>
        <div className="segmented" role="tablist" aria-label="איך נכנסים">
          <button role="tab" aria-selected={mode === 'pin'} className={mode === 'pin' ? 'on' : ''} onClick={() => setMode('pin')}>🖼️ תמונה וקוד</button>
          <button role="tab" aria-selected={mode === 'password'} className={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>🔑 שם משתמש וסיסמה</button>
        </div>
        {mode === 'pin' ? <PinLogin /> : <PasswordLogin />}
      </main>
    </div>
  )
}

function PinLogin() {
  const data = useData()
  const profiles = useAsync(() => data.pinProfiles(), [data])
  const [who, setWho] = useState<PinProfile | null>(null)
  if (who) return <PinPad profile={who} onBack={() => setWho(null)} />
  return (
    <>
      <p className="muted center">לוחצים על התמונה שלך.</p>
      <AsyncView state={profiles} isEmpty={p => p.length === 0}>
        {list => (
          <div className="pick-grid">
            {list.map(p => (
              <button key={p.id} className="pick" onClick={() => setWho(p)} aria-label={`אני ${p.firstName}`}>
                <Avatar src={p.avatar} name={p.firstName} size={88} />
                <b>{p.firstName}</b>
              </button>
            ))}
          </div>
        )}
      </AsyncView>
      <p className="small muted center">במערכת האמיתית הכניסה בקוד אפשרית רק ממכשיר שהורה אישר מראש.</p>
    </>
  )
}

function PinPad({ profile, onBack }: { profile: PinProfile; onBack(): void }) {
  const data = useData()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (pin.length !== PIN_LEN) return
    let cancelled = false
    setBusy(true)
    data.signInPin(profile.id, pin).then(
      s => { if (!cancelled) { signIn(s); navigate('/student', { replace: true }) } },
      err => {
        if (cancelled) return
        setPin(''); setBusy(false)
        const d = err instanceof LoginError ? err.detail : undefined
        setLocked(!!d && !d.ok)
        setMsg(err.message + (d && d.ok ? ` (נשארו ${d.remaining} ניסיונות)` : ''))
      },
    )
    return () => { cancelled = true }
  }, [pin, data, profile.id, signIn, navigate])

  const press = (k: string) => { if (busy || locked) return; setMsg(''); setPin(p => (k === 'del' ? p.slice(0, -1) : p.length < PIN_LEN ? p + k : p)) }

  return (
    <div className="pinpad-wrap">
      <div className="center"><Avatar src={profile.avatar} name={profile.firstName} size={96} /><h2>שלום {profile.firstName}!</h2><p className="muted">מקלידים את הקוד הסודי שלך.</p></div>
      <div className="pin-dots" aria-label={`הוקלדו ${pin.length} מתוך ${PIN_LEN} ספרות`}>
        {Array.from({ length: PIN_LEN }, (_, i) => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
      </div>
      {msg && <p className={`form-error center ${locked ? 'locked' : ''}`} role="alert">{msg}</p>}
      <div className="pinpad" aria-label="מקלדת מספרים">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => <button key={k} onClick={() => press(k)} disabled={busy || locked}>{k}</button>)}
        <button onClick={onBack} className="pin-aux" aria-label="חזרה לתמונות">↩</button>
        <button onClick={() => press('0')} disabled={busy || locked}>0</button>
        <button onClick={() => press('del')} className="pin-aux" aria-label="מחיקה" disabled={busy || locked}>⌫</button>
      </div>
      <p className="small muted center">קוד לדוגמה: <code dir="ltr">{DEMO_PIN}</code> · אחרי 5 טעויות החשבון ננעל לרבע שעה</p>
    </div>
  )
}

function PasswordLogin() {
  const data = useData()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) { setError('צריך למלא שם משתמש וסיסמה'); return }
    setBusy(true)
    try { signIn(await data.signInPassword(username, password)); navigate('/student', { replace: true }) }
    catch (err) {
      const d = err instanceof LoginError ? err.detail : undefined
      setError((err as Error).message + (d && d.ok ? ` (נשארו ${d.remaining} ניסיונות)` : ''))
    } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} noValidate className="pw-form">
      <label className="field">שם משתמש
        <input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} dir="ltr" />
      </label>
      <label className="field">סיסמה
        <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'נכנסים…' : 'כניסה'}</button>
      <p className="small muted">לדוגמה: <code dir="ltr">tamar.levi</code> / <code dir="ltr">{DEMO_PASSWORD}</code> · שכחת סיסמה? רק הורה יכול לאפס אותה.</p>
    </form>
  )
}
