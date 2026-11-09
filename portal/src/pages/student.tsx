import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState, ErrorState, Loading } from '../components/States'
import { Avatar, KIND_TEXT, ProgressBadge, ProgressBar, SpeakButton, formatDate, isDone } from '../components/ui'
import { useData } from '../data'
import { SUBJECTS } from '../data/types'
import type { QuizResult } from '../data/types'
import type { StudentTask } from '../data/source'
import { useAsync } from '../hooks/useAsync'
import { ProgressQueue, attachTelemetry, prepareEngineStorage } from '../player/bridge'
import { SharedMaterials } from './materials'

function useTasks() {
  const data = useData(), s = useSession()
  return useAsync(() => data.myTasks(s), [data, s.userId])
}

function TaskAction({ t, onChange }: { t: StudentTask; onChange?: () => void }) {
  const data = useData(), s = useSession()
  const [busy, setBusy] = useState(false)
  const done = isDone(t.progress)
  if (t.kind === 'practice' && t.playPath) return <Link className="btn btn-go" to={`/student/play/${t.id}`}>{done ? 'לתרגל שוב' : 'להתחיל'} ▶</Link>
  if (t.kind === 'quiz') {
    if (t.progress?.state === 'completed' && (t.progress.attempts ?? 0) >= 3) return <span className="small">כל הניסיונות נוצלו</span>
    return <Link className="btn btn-go" to={`/student/quiz/${t.id}`}>{t.progress?.state === 'completed' ? 'לנסות שוב' : 'למבחן'} ▶</Link>
  }
  // reading: the child says "I read it" – recorded as practice, not as a result
  async function readDone() {
    setBusy(true)
    try {
      const sid = await data.startSession(s, t.id)
      await data.recordProgress(s, sid, [{ id: crypto.randomUUID(), kind: 'round_done' }])
      await data.finishSession(s, sid)
      onChange?.()
    } finally { setBusy(false) }
  }
  return done ? <span className="small">✓ קראת</span> : <button className="btn btn-go" disabled={busy} onClick={readDone}>קראתי ✓</button>
}

function TaskCard({ t, onChange }: { t: StudentTask; onChange?: () => void }) {
  const subject = SUBJECTS[t.group.subject]
  return (
    <article className={`task ${isDone(t.progress) ? 'task-done' : ''}`} style={{ background: subject.color }}>
      <div className="task-top">
        <span className="task-emoji" aria-hidden>{KIND_TEXT[t.kind].emoji}</span>
        <ProgressBadge progress={t.progress} />
      </div>
      <h2>{t.title}</h2>
      <p className="task-meta">{subject.emoji} {subject.name} · {KIND_TEXT[t.kind].name}{t.dueAt ? ` · עד ${formatDate(t.dueAt)}` : ''}</p>
      <p className="task-text">{t.instructions}</p>
      <div className="row wrap">
        <SpeakButton text={`${t.title}. ${t.instructions}`} />
        <TaskAction t={t} onChange={onChange} />
      </div>
    </article>
  )
}

export function StudentHome() {
  const s = useSession()
  const st = useTasks()
  const first = s.fullName.split(' ')[0]
  return (
    <>
      <section className="kid-hero">
        <Avatar src={s.avatar} name={s.fullName} size={84} />
        <div>
          <h1>היי {first}! ☀️</h1>
          <p>מה לומדים היום?</p>
        </div>
        <SpeakButton text={`היי ${first}! מה לומדים היום?`} label="לשמוע" />
      </section>
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState emoji="🎈" title="אין לך משימות כרגע" message="כשהמורה תשייך משימה, היא תופיע כאן." />}>
        {tasks => tasks.every(t => isDone(t.progress))
          ? <EmptyState emoji="🎉" title="כל המשימות הושלמו!" message="כל הכבוד. אפשר לנוח או לתרגל שוב." />
          : (
          <div className="task-grid">{tasks.filter(t => !isDone(t.progress)).sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9')).slice(0, 3).map(t => <TaskCard key={t.id} t={t} onChange={st.reload} />)}</div>
        )}
      </AsyncView>
    </>
  )
}

export function StudentTasks() {
  const st = useTasks()
  return (
    <>
      <h1 className="kid-title">🎯 המשימות שלי</h1>
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState emoji="🎈" title="אין לך משימות כרגע" />}>
        {tasks => <div className="task-grid">{tasks.map(t => <TaskCard key={t.id} t={t} onChange={st.reload} />)}</div>}
      </AsyncView>
      <SharedMaterials />
    </>
  )
}

export function StudentTests() {
  const st = useTasks()
  return (
    <>
      <h1 className="kid-title">📝 מבחנים</h1>
      <p className="kid-note">אין שעון במבחנים. עונים בקצב שלך, ואפשר לשמוע כל שאלה.</p>
      <AsyncView state={st} isEmpty={l => !l.some(t => t.kind === 'quiz')} empty={<EmptyState emoji="😌" title="אין מבחנים קרובים" />}>
        {tasks => <div className="task-grid">{tasks.filter(t => t.kind === 'quiz').map(t => <TaskCard key={t.id} t={t} />)}</div>}
      </AsyncView>
    </>
  )
}

/** the existing learning engine, embedded; progress goes to the server as UNVERIFIED practice */
export function PlayPage() {
  const { assignmentId = '' } = useParams()
  const data = useData(), s = useSession(), navigate = useNavigate()
  const st = useAsync(() => data.assignmentDetail(s, assignmentId), [data, s.userId, assignmentId])
  const [sid, setSid] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(0)
  const queue = useRef<ProgressQueue | null>(null)
  const started = useRef(false)
  const detach = useRef<() => void>(() => {})

  useEffect(() => {
    if (!st.data || started.current) return
    started.current = true
    prepareEngineStorage(s.userId)
    data.startSession(s, assignmentId).then(id => {
      setSid(id)
      queue.current = new ProgressQueue(events => data.recordProgress(s, id, events), { onChange: () => setSaved(queue.current?.sent ?? 0) })
    }, e => setError((e as Error).message))
  }, [st.data, data, s, assignmentId])

  useEffect(() => () => {           // leaving the page: stop listening, send what is left, close the session
    detach.current()
    const q = queue.current, id = sid
    if (q && id) void q.flush().finally(() => data.finishSession(s, id).catch(() => {}))
  }, [sid, data, s])

  function onFrameLoad(e: React.SyntheticEvent<HTMLIFrameElement>) {
    const win = e.currentTarget.contentWindow as unknown as { track?: (k: string, d?: Record<string, unknown>) => unknown } | null
    if (!win || !queue.current) return
    detach.current()
    detach.current = attachTelemetry(win, ev => queue.current?.push(ev))
  }
  async function finish() {
    await queue.current?.flush()
    if (sid) await data.finishSession(s, sid).catch(() => {})
    navigate('/student')
  }

  if (st.loading) return <Loading />
  if (st.error || !st.data) return <ErrorState title="המשימה לא זמינה" message={st.error?.message} action={{ label: 'למשימות שלי', to: '/student/tasks' }} />
  const a = st.data
  if (a.kind !== 'practice' || !a.playPath) return <ErrorState title="זו לא משימת תרגול" action={{ label: 'למשימות שלי', to: '/student/tasks' }} />
  if (error) return <ErrorState title="לא הצלחנו להתחיל" message={error} />
  return (
    <div className="player-wrap">
      <div className="player-bar">
        <b>{KIND_TEXT.practice.emoji} {a.title}</b>
        <span className="small" role="status">{sid ? `נשמרו ${saved} תשובות${queue.current?.failed ? ' · אין חיבור, ננסה שוב' : ''}` : 'מתחילים…'}</span>
        <button className="btn btn-primary" onClick={finish}>סיימתי</button>
      </div>
      {sid && <iframe className="player-frame" title={`תרגול: ${a.title}`} src={`play/${a.playPath}`} onLoad={onFrameLoad} referrerPolicy="no-referrer" />}
    </div>
  )
}

/** a server-graded quiz: the answers go to the server, which grades them against keys this page never receives */
export function QuizPage() {
  const { assignmentId = '' } = useParams()
  const data = useData(), s = useSession()
  const st = useAsync(() => data.assignmentDetail(s, assignmentId), [data, s.userId, assignmentId])
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (st.loading) return <Loading />
  if (st.error || !st.data) return <ErrorState title="המבחן לא זמין" message={st.error?.message} action={{ label: 'למשימות שלי', to: '/student/tasks' }} />
  const a = st.data, items = a.items ?? []
  const all = items.every(it => answers[it.position] !== undefined)
  async function submit() {
    setError(''); setBusy(true)
    try { setResult(await data.submitQuiz(s, a.id, items.map(it => answers[it.position]))) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (result) {
    return (
      <section className="result-card" role="status">
        <div aria-hidden style={{ fontSize: '3rem' }}>{result.score === result.max ? '🏆' : '⭐'}</div>
        <h1>{a.title}</h1>
        <p className="big-score">{result.score}/{result.max}</p>
        <p>{result.score === result.max ? 'מושלם!' : 'כל הכבוד על המאמץ!'} {result.attemptsLeft > 0 ? `נשארו ${result.attemptsLeft} ניסיונות.` : ''}</p>
        <SpeakButton text={`קיבלת ${result.score} מתוך ${result.max}`} label="לשמוע" />
        <p><Link className="btn btn-primary" to="/student">חזרה</Link></p>
      </section>
    )
  }
  return (
    <>
      <h1 className="kid-title">{KIND_TEXT.quiz.emoji} {a.title}</h1>
      <p className="kid-note">אין שעון. בוחרים תשובה לכל שאלה, ובסוף לוחצים "הגשה".</p>
      {items.map(it => (
        <section key={it.position} className="quiz-q" aria-labelledby={`q${it.position}`}>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <h2 id={`q${it.position}`}>{it.position}. {it.prompt}</h2>
            <SpeakButton text={`${it.prompt}. ${it.options.join(', ')}`} label="לשמוע" />
          </div>
          <div className="quiz-opts" role="radiogroup" aria-labelledby={`q${it.position}`}>
            {it.options.map((o, i) => (
              <button key={i} role="radio" aria-checked={answers[it.position] === i} className={`quiz-opt ${answers[it.position] === i ? 'on' : ''}`}
                onClick={() => setAnswers(x => ({ ...x, [it.position]: i }))}>{o}</button>
            ))}
          </div>
        </section>
      ))}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-go" disabled={!all || busy} onClick={submit}>{busy ? 'בודקים…' : 'הגשה'}</button>
      {!all && <p className="small muted">צריך לענות על כל השאלות.</p>}
    </>
  )
}

const ACHIEVEMENTS = [
  { id: 'first', emoji: '🌱', title: 'משימה ראשונה', test: (d: Stats) => d.done >= 1 },
  { id: 'five', emoji: '🚀', title: '5 משימות', test: (d: Stats) => d.done >= 5 },
  { id: 'q50', emoji: '💪', title: '50 שאלות בתרגול', test: (d: Stats) => d.questions >= 50 },
  { id: 'perfect', emoji: '🏆', title: 'מבחן מושלם', test: (d: Stats) => d.perfect >= 1 },
]
interface Stats { done: number; questions: number; perfect: number }

export function StudentProgress() {
  const data = useData(), s = useSession()
  const st = useAsync(async () => {
    const [subjects, tasks] = await Promise.all([data.myProgress(s), data.myTasks(s)])
    return { subjects, tasks }
  }, [data, s.userId])
  return (
    <>
      <h1 className="kid-title">⭐ ההתקדמות שלי</h1>
      <AsyncView state={st}>
        {({ subjects, tasks }) => {
          const stats: Stats = { done: tasks.filter(t => isDone(t.progress)).length,
            // all practice (subjects) includes the assignments' practice – take the larger total, never add both
            questions: Math.max(tasks.reduce((n, t) => n + (t.progress?.practiceQuestions ?? 0), 0), subjects.reduce((n, x) => n + x.questions, 0)),
            perfect: tasks.filter(t => t.progress?.verifiedMax && t.progress.verifiedScore === t.progress.verifiedMax).length }
          return (
            <>
              <h2>ההישגים שלי</h2>
              <div className="achievements">{ACHIEVEMENTS.map(a => {
                const got = a.test(stats)
                return <div key={a.id} className={`achievement ${got ? '' : 'locked'}`} aria-label={`${a.title}${got ? ' – הושג' : ' – עוד לא'}`}><div className="a-emoji" aria-hidden>{a.emoji}</div><b>{a.title}</b></div>
              })}</div>
              <h2>משימות שסיימתי</h2>
              {stats.done === 0 ? <EmptyState emoji="🌱" title="עוד לא סיימת משימות" /> : (
                <ul className="history">{tasks.filter(t => isDone(t.progress)).map(t => (
                  <li key={t.id}><span>{KIND_TEXT[t.kind].emoji} {t.title}</span><ProgressBadge progress={t.progress} /></li>
                ))}</ul>
              )}
              <h2 style={{ marginTop: 18 }}>לפי מקצוע</h2>
              {subjects.length === 0 ? <EmptyState emoji="🌱" title="עוד אין תרגולים" message="אחרי התרגול הראשון יופיעו כאן הכוכבים שלך." /> : (
                <div className="task-grid">{subjects.map(sp => (
                  <article key={sp.subject} className="task" style={{ background: SUBJECTS[sp.subject].color }}>
                    <h2>{SUBJECTS[sp.subject].emoji} {SUBJECTS[sp.subject].name}</h2>
                    <p className="stars" aria-label={`${Math.round(sp.firstTry / 20)} כוכבים מתוך 5`}>{'★'.repeat(Math.round(sp.firstTry / 20))}{'☆'.repeat(5 - Math.round(sp.firstTry / 20))}</p>
                    <ProgressBar value={sp.firstTry} label={`הצלחה מהפעם הראשונה ב${SUBJECTS[sp.subject].name}`} />
                    <p className="task-text">פתרת {sp.questions} שאלות ב-{sp.daysActive} ימים.</p>
                    {sp.strong.length > 0 && <p className="task-text">💪 את/ה כבר טוב/ה ב: {sp.strong.join(', ')}</p>}
                    {sp.needsWork.length > 0 && <p className="task-text">🎯 עוד קצת תרגול: {sp.needsWork.join(', ')}</p>}
                  </article>
                ))}</div>
              )}
            </>
          )
        }}
      </AsyncView>
    </>
  )
}
