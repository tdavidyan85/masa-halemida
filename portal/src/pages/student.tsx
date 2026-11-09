import { useSession } from '../auth/AuthContext'
import { AsyncView, EmptyState } from '../components/States'
import { Avatar, KIND_TEXT, ProgressBadge, ProgressBar, SpeakButton, formatDate } from '../components/ui'
import { useData } from '../data'
import { SUBJECTS } from '../data/types'
import type { StudentTask } from '../data/source'
import { useAsync } from '../hooks/useAsync'

/** where the existing learning engine lives; it is opened as is (no data is passed to it) */
const GAME_BASE: string = import.meta.env.VITE_GAME_BASE ?? 'https://tdavidyan85.github.io/masa-halemida/'

function useTasks() {
  const data = useData(), s = useSession()
  return useAsync(() => data.myTasks(s), [data, s.userId])
}

function TaskCard({ t }: { t: StudentTask }) {
  const subject = SUBJECTS[t.group.subject]
  const done = t.progress?.state === 'done'
  return (
    <article className={`task ${done ? 'task-done' : ''}`} style={{ background: subject.color }}>
      <div className="task-top">
        <span className="task-emoji" aria-hidden>{KIND_TEXT[t.kind].emoji}</span>
        <ProgressBadge state={t.progress?.state} score={t.progress?.score} />
      </div>
      <h2>{t.title}</h2>
      <p className="task-meta">{subject.emoji} {subject.name} · {KIND_TEXT[t.kind].name} · עד {formatDate(t.dueAt)}</p>
      <p className="task-text">{t.instructions}</p>
      <div className="row wrap">
        <SpeakButton text={`${t.title}. ${t.instructions}`} />
        {t.playPath
          ? <a className="btn btn-go" href={GAME_BASE + t.playPath} target="_blank" rel="noopener">{done ? 'לתרגל שוב' : 'להתחיל'} ▶</a>
          : <span className="small">המשימה תיפתח כאן בקרוב</span>}
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
        {tasks => tasks.every(t => t.progress?.state === 'done')
          ? <EmptyState emoji="🎉" title="כל המשימות הושלמו!" message="כל הכבוד. אפשר לנוח או לתרגל שוב." />
          : (
          <div className="task-grid">{tasks.filter(t => t.progress?.state !== 'done').sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 3).map(t => <TaskCard key={t.id} t={t} />)}</div>
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
        {tasks => <div className="task-grid">{tasks.map(t => <TaskCard key={t.id} t={t} />)}</div>}
      </AsyncView>
    </>
  )
}

export function StudentTests() {
  const st = useTasks()
  return (
    <>
      <h1 className="kid-title">📝 מבחנים</h1>
      <p className="kid-note">אין שעון במבחנים. עונים בקצב שלך, ואפשר לשמוע כל שאלה.</p>
      <AsyncView state={st} isEmpty={l => !l.some(t => t.kind === 'exam')} empty={<EmptyState emoji="😌" title="אין מבחנים קרובים" />}>
        {tasks => <div className="task-grid">{tasks.filter(t => t.kind === 'exam').map(t => <TaskCard key={t.id} t={t} />)}</div>}
      </AsyncView>
    </>
  )
}

export function StudentProgress() {
  const data = useData(), s = useSession()
  const st = useAsync(() => data.myProgress(s), [data, s.userId])
  return (
    <>
      <h1 className="kid-title">⭐ ההתקדמות שלי</h1>
      <AsyncView state={st} isEmpty={l => l.length === 0} empty={<EmptyState emoji="🌱" title="עוד אין תרגולים" message="אחרי התרגול הראשון יופיעו כאן הכוכבים שלך." />}>
        {list => (
          <div className="task-grid">{list.map(sp => (
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
      </AsyncView>
    </>
  )
}
