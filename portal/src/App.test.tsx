// Screens and navigation, rendered with the mock data source (no delay) and an in-memory router.
import { act, render, screen, within } from '@testing-library/react'
import { SupabaseSource } from './data/supabaseSource'
import { fakeSupabase } from './test/fakeSupabase'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AppRoutes, Providers } from './App'
import { NAV } from './components/AppShell'
import { MockSource } from './data/mockSource'
import type { MockOptions } from './data/mockSource'
import { ADULTS, DEMO_PASSWORD, DEMO_PIN, STUDENTS } from './data/mockData'
import type { Role, Session } from './data/types'
import { ForbiddenError } from './data/source'

beforeEach(() => sessionStorage.clear())

function sessionFor(id: string): Session {
  const p = [...ADULTS, ...STUDENTS].find(x => x.id === id)!
  return { userId: p.id, role: p.role, fullName: p.fullName, avatar: p.avatar }
}
function renderAt(path: string, session: Session | null = null, opts: MockOptions = {}) {
  const source = new MockSource({ delayMs: 0, ...opts })
  render(<Providers source={source} session={session}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></Providers>)
  return { source, user: userEvent.setup() }
}

describe('entry and sign-in', () => {
  it('the landing page offers a student and an adult entrance', async () => {
    const { user } = renderAt('/')
    expect(screen.getByRole('heading', { name: 'מסע הלמידה' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /אני מבוגר/ }))
    expect(screen.getByRole('heading', { name: 'כניסה למבוגרים' })).toBeInTheDocument()
  })

  it.each([
    ['מנהלת מערכת', 'ניהול המערכת'],
    ['מורה', 'שלום מיכל'],
    ['הורה', 'שלום רונית'],
  ])('a %s signs in and lands in the right environment', async (sample, heading) => {
    const { user } = renderAt('/login')
    await user.click(screen.getByRole('button', { name: new RegExp(`^\\S*\\s*${sample}$`) }))
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('heading', { name: new RegExp(heading) })).toBeInTheDocument()
  })

  it('shows a clear error for a wrong password and for a teacher still waiting for approval', async () => {
    const { user } = renderAt('/login')
    await user.type(screen.getByLabelText('דוא״ל'), 'michal@demo.local')
    await user.type(screen.getByLabelText('סיסמה'), 'nope')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('הדוא״ל או הסיסמה לא נכונים')
    await user.click(screen.getByRole('button', { name: /ממתינה לאישור/ }))
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ממתין לאישור')
  })

  it('a young child picks their picture and types the PIN', async () => {
    const { user } = renderAt('/login/student')
    await user.click(await screen.findByRole('button', { name: 'אני נועם' }))
    for (const d of DEMO_PIN) await user.click(screen.getByRole('button', { name: d }))
    expect(await screen.findByRole('heading', { name: /היי נועם/ })).toBeInTheDocument()
  })

  it('locks the PIN after 5 wrong codes and disables the keypad', async () => {
    const { user } = renderAt('/login/student')
    await user.click(await screen.findByRole('button', { name: 'אני נועם' }))
    for (let i = 0; i < 5; i++) {
      for (const d of '999999') await user.click(screen.getByRole('button', { name: d }))
      await screen.findByRole('alert')
    }
    expect(screen.getByRole('alert')).toHaveTextContent('יותר מדי ניסיונות')
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
  })

  it('an older student signs in with a username and password', async () => {
    const { user } = renderAt('/login/student')
    await user.click(screen.getByRole('tab', { name: /שם משתמש/ }))
    await user.type(screen.getByLabelText('שם משתמש'), 'tamar.levi')
    await user.type(screen.getByLabelText('סיסמה'), DEMO_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('heading', { name: /היי תמר/ })).toBeInTheDocument()
  })
})

describe('environments and navigation', () => {
  const homes: [Role, string, string][] = [
    ['admin', 'u-admin', '/admin'], ['teacher', 'u-t1', '/teacher'], ['parent', 'u-p1', '/parent'], ['student', 's-tamar', '/student'],
  ]

  it.each(homes)('%s: the menu has exactly its own items, and every item opens a page', async (role, id, home) => {
    const { user } = renderAt(home, sessionFor(id))
    const nav = screen.getByRole('navigation', { name: 'ניווט ראשי' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(l => l.querySelector('.nav-label')?.textContent)).toEqual(NAV[role].map(i => i.label))
    for (const item of NAV[role]) {
      await user.click(within(nav).getByRole('link', { name: new RegExp(item.label) }))
      expect(within(nav).getByRole('link', { name: new RegExp(item.label) })).toHaveClass('active')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    }
  })

  it.each(homes)('%s: every screen says it is a demo', (_r, id, home) => {
    renderAt(home, sessionFor(id))
    expect(screen.getByRole('note')).toHaveTextContent('אין כאן התחברות אמיתית או הרשאות מאובטחות')
  })

  it('a student who opens the admin area is stopped', () => {
    renderAt('/admin/users', sessionFor('s-noam'))
    expect(screen.getByRole('heading', { name: 'אין גישה לאזור הזה' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'חזרה לאזור שלי' })).toHaveAttribute('href', '/student')
  })

  it('without a session, a protected page sends you to sign in', () => {
    renderAt('/teacher/groups')
    expect(screen.getByRole('heading', { name: 'כניסה למבוגרים' })).toBeInTheDocument()
    renderAt('/student/tasks')
    expect(screen.getAllByRole('heading', { name: /מי נכנס/ }).length).toBeGreaterThan(0)
  })

  it('signing out returns to the sign-in page', async () => {
    const { user } = renderAt('/parent', sessionFor('u-p1'))
    await user.click(screen.getByRole('button', { name: 'יציאה' }))
    expect(screen.getByRole('heading', { name: 'כניסה למבוגרים' })).toBeInTheDocument()
  })

  it('an unknown address shows a friendly "not found"', () => {
    renderAt('/nowhere')
    expect(screen.getByRole('heading', { name: 'העמוד לא נמצא' })).toBeInTheDocument()
  })
})

describe('screens', () => {
  it('teacher: opens a group and sees its students with their progress', async () => {
    const { user } = renderAt('/teacher/groups', sessionFor('u-t1'))
    await user.click(await screen.findByRole('link', { name: /חשבון ה׳ – קבוצת תגבור/ }))
    const table = await screen.findByRole('table')
    expect(within(table).getByText('תמר לוי')).toBeInTheDocument()
    expect(within(table).getByText('ליאור כץ')).toBeInTheDocument()
    expect(within(table).getByText(/2\/3/)).toBeInTheDocument()                      // verified quiz result
    expect(within(table).getAllByText('תרגול').length).toBeGreaterThan(0)            // practice is labelled as practice
    expect(within(table).queryByText(/טיוטה: גאומטריה/)).not.toBeInTheDocument()     // drafts are not in the progress table
  })

  it('teacher: creates a new group', async () => {
    const { user } = renderAt('/teacher/groups', sessionFor('u-t1'))
    await user.click(await screen.findByRole('button', { name: '+ קבוצה חדשה' }))
    await user.type(screen.getByLabelText('שם הקבוצה'), 'מדעים ג׳')
    await user.click(screen.getByRole('button', { name: 'יצירת הקבוצה' }))
    expect(await screen.findByRole('link', { name: /מדעים ג׳/ })).toBeInTheDocument()
  })

  it('teacher with no groups sees a helpful empty state', async () => {
    renderAt('/teacher/groups', sessionFor('u-t3'))
    expect(await screen.findByRole('heading', { name: 'עוד אין לך קבוצות' })).toBeInTheDocument()
  })

  it('parent: approves an invitation for the right child', async () => {
    const { user } = renderAt('/parent/approvals', sessionFor('u-p1'))
    await screen.findByText(/מזמינה את "נועם"/)
    expect(screen.getByRole('combobox')).toHaveValue('s-noam') // guessed from the teacher's hint
    await user.click(screen.getByRole('button', { name: 'אישור והצטרפות' }))
    expect(await screen.findByRole('heading', { name: 'אין הזמנות חדשות' })).toBeInTheDocument()
    expect(screen.getByText('אושרה')).toBeInTheDocument()
  })

  it('parent: sees progress for every child in every subject', async () => {
    renderAt('/parent/progress', sessionFor('u-p1'))
    expect(await screen.findByRole('heading', { name: 'תמר לוי' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'נועם לוי' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /חשבון/ })).toHaveAttribute('aria-valuenow', '78')
    expect(screen.getByRole('progressbar', { name: /אנגלית/ })).toBeInTheDocument()
  })

  it('student: sees only their own tasks, with a read-aloud button and no timer in tests', async () => {
    const { user } = renderAt('/student/tasks', sessionFor('s-tamar'))
    expect(await screen.findByRole('heading', { name: 'שברים: חיבור וחיסור' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'קריאה: קמץ ופתח' })).not.toBeInTheDocument() // another group
    await user.click(screen.getByRole('link', { name: /מבחנים/ }))
    expect(await screen.findByText(/אין שעון במבחנים/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'מבחן קצר: מספרים גדולים' })).toBeInTheDocument()
  })

  it('student with no tasks at all is NOT told "all tasks completed" (found in the local Supabase run)', async () => {
    const source = new MockSource({ delayMs: 0 })
    source.myTasks = async () => []
    render(<Providers source={source} session={sessionFor('s-noam')}><MemoryRouter initialEntries={['/student']}><AppRoutes /></MemoryRouter></Providers>)
    expect(await screen.findByRole('heading', { name: 'אין לך משימות כרגע' })).toBeInTheDocument()
    expect(screen.queryByText('כל המשימות הושלמו!')).not.toBeInTheDocument()
  })
  it('profile pictures are labeled as samples', async () => {
    renderAt('/teacher/students', sessionFor('u-t1'))
    await screen.findByText('ליאור כץ')
    const imgs = screen.getAllByRole('img', { name: /תמונת פרופיל לדוגמה/ })
    expect(imgs.length).toBeGreaterThan(2)
    expect(imgs.every(i => i.getAttribute('src')!.startsWith('data:image/svg+xml'))).toBe(true)
  })

  it('a loading failure shows an error with a retry button', async () => {
    renderAt('/parent', sessionFor('u-p1'), { failWith: 'השרת לא זמין' })
    expect(await screen.findByRole('heading', { name: 'לא הצלחנו לטעון' })).toBeInTheDocument()
    expect(screen.getByText('השרת לא זמין')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'לנסות שוב' })).toBeInTheDocument()
  })

  it('shows a loading state while data is on its way', async () => {
    renderAt('/admin', sessionFor('u-admin'), { delayMs: 50 })
    expect(screen.getByRole('status')).toHaveTextContent('טוען')
    expect(await screen.findByText('קבוצות פעילות')).toBeInTheDocument()
  })
})

describe('account pages', () => {
  it('the sign-in page links to sign-up and password reset', async () => {
    const { user } = renderAt('/login')
    await user.click(screen.getByRole('link', { name: /הרשמה/ }))
    expect(screen.getByRole('heading', { name: 'הרשמה' })).toBeInTheDocument()
  })
  it('in the demo, sign-up explains that no accounts are created', async () => {
    const { user } = renderAt('/signup')
    await user.type(screen.getByLabelText('שם מלא'), 'דנה כהן')
    await user.type(screen.getByLabelText('דוא״ל'), 'dana@example.org')
    await user.type(screen.getByLabelText(/סיסמה/), 'long-password')
    await user.click(screen.getByRole('button', { name: 'הרשמה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('בהדגמה לא נוצרים חשבונות')
  })
  it('sign-up validates before sending anything', async () => {
    const { user } = renderAt('/signup')
    await user.click(screen.getByRole('button', { name: 'הרשמה' }))
    expect(screen.getByRole('alert')).toHaveTextContent('צריך שם מלא')
  })
  it('in the demo, password reset points to the demo password', async () => {
    const { user } = renderAt('/forgot-password')
    await user.type(screen.getByLabelText('דוא״ל'), 'ronit@demo.local')
    await user.click(screen.getByRole('button', { name: 'שליחת קישור' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('demo1234')
  })
  it('opening the reset page without a valid link says so', () => {
    renderAt('/reset-password')
    expect(screen.getByRole('alert')).toHaveTextContent('הקישור לא תקף')
  })
  it('a parent adding a child in the demo is told it needs the server', async () => {
    const { user } = renderAt('/parent', sessionFor('u-p1'))
    await user.click(await screen.findByRole('button', { name: '+ ילד/ה' }))
    await user.type(screen.getByLabelText('שם מלא'), 'ילד חדש')
    await user.type(screen.getByLabelText('תאריך לידה'), '2019-04-04')
    await user.type(screen.getByLabelText('קוד של 6 ספרות'), '480317')
    await user.click(screen.getByRole('button', { name: 'יצירת החשבון' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('בהדגמה לא יוצרים חשבונות ילדים')
  })
})

describe('server mode (fake Supabase client)', () => {
  function renderServer(path: string) {
    const f = fakeSupabase({ tables: { profiles: [{ id: 'u1', full_name: 'הורה בדיקה', avatar_path: null, status: 'active' }], user_roles: [{ user_id: 'u1', role: 'parent', status: 'active' }] } })
    const source = new SupabaseSource(f.client, 'http://localhost/')
    render(<Providers source={source}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></Providers>)
    return { ...f, user: userEvent.setup() }
  }
  it('says clearly that it is a development server, and hides the demo accounts', async () => {
    renderServer('/login')
    expect(screen.getByRole('note')).toHaveTextContent('שרת פיתוח')
    expect(screen.queryByText('חשבונות לדוגמה')).not.toBeInTheDocument()
  })
  it('a protected page waits for the stored session, then asks to sign in', async () => {
    renderServer('/parent')
    expect(await screen.findByRole('heading', { name: 'כניסה למבוגרים' })).toBeInTheDocument()
  })
  it('a password-reset link leads straight to choosing a new password', async () => {
    const f = renderServer('/login')
    act(() => f.emit('PASSWORD_RECOVERY', { id: 'u1' }))
    expect(await screen.findByRole('heading', { name: 'בחירת סיסמה חדשה' })).toBeInTheDocument()
    expect(await screen.findByLabelText('סיסמה חדשה')).toBeInTheDocument()
  })
})

describe('learning workflow (demo data source)', () => {
  it('teacher → quiz → publish; student takes it; teacher and parent see the VERIFIED result', async () => {
    const source = new MockSource({ delayMs: 0 })
    const user = userEvent.setup()
    const view = (path: string, who: string) => render(<Providers source={source} session={sessionFor(who)}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></Providers>)
    let r = view('/teacher/assignments', 'u-t1')
    await user.click(await screen.findByRole('button', { name: '+ משימה חדשה' }))
    await user.selectOptions(screen.getByLabelText('סוג'), 'quiz')
    await user.type(screen.getByLabelText('כותרת'), 'חידון שברים')
    await user.type(screen.getByLabelText('ניסוח שאלה 1'), 'כמה זה חצי ועוד חצי?')
    await user.type(screen.getByLabelText('שאלה 1 תשובה 1'), '1')
    await user.type(screen.getByLabelText('שאלה 1 תשובה 2'), '2')
    await user.click(screen.getByRole('button', { name: 'שמירה כטיוטה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('סימון התשובה הנכונה')          // no key → not saved
    await user.click(screen.getByLabelText('תשובה 1 נכונה'))
    await user.click(screen.getByRole('button', { name: 'שמירה כטיוטה' }))
    const card = (await screen.findByRole('heading', { name: /חידון שברים/ })).closest('section')!
    expect(within(card).getByText('טיוטה')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'פרסום' }))
    expect(await screen.findByText(/פורסם לקבוצה/)).toBeInTheDocument()
    r.unmount()

    r = view('/student/tests', 's-tamar')
    const quizCard = (await screen.findByRole('heading', { name: 'חידון שברים' })).closest('article')!
    await user.click(within(quizCard).getByRole('link', { name: /למבחן/ }))
    await user.click(await screen.findByRole('radio', { name: '1' }))
    await user.click(screen.getByRole('button', { name: 'הגשה' }))
    expect(await screen.findByText('1/1')).toBeInTheDocument()
    r.unmount()

    r = view('/parent/progress', 'u-p1')
    const tamar = (await screen.findByRole('heading', { name: 'תמר לוי' })).closest('section')!
    const row = within(tamar).getByText(/חידון שברים/).closest('li')!
    expect(within(row).getByText(/1\/1/)).toBeInTheDocument()
    expect(within(tamar).getByRole('heading', { name: 'היסטוריית למידה' })).toBeInTheDocument()
    r.unmount()
  })
  it('students never see drafts, and a published quiz reaches the student without answer keys', async () => {
    const source = new MockSource({ delayMs: 0 })
    const tasks = await source.myTasks(sessionFor('s-tamar'))
    expect(tasks.map(t => t.title)).not.toContain('טיוטה: גאומטריה')
    const quiz = await source.assignmentDetail(sessionFor('s-tamar'), 'as-2')
    expect(quiz.items!.every(it => it.answerIndex === undefined)).toBe(true)
    const forTeacher = await source.assignmentDetail(sessionFor('u-t1'), 'as-2')
    expect(forTeacher.items!.every(it => typeof it.answerIndex === 'number')).toBe(true)
  })
  it('the practice player embeds the existing engine from the portal\'s own origin, with no token in the URL', async () => {
    renderAt('/student/play/as-1', sessionFor('s-tamar'))
    const frame = await screen.findByTitle('תרגול: שברים: חיבור וחיסור')
    expect(frame).toHaveAttribute('src', 'play/fractions/')
    expect(frame.getAttribute('src')).not.toMatch(/token|session|key|#|\?/)
    expect(screen.getByRole('status')).toHaveTextContent(/נשמרו 0 תשובות/)
  })
})

describe('learning materials (demo data source)', () => {
  const TEXT = 'פרק 1: מחזור המים\nהמים בים מתחממים בשמש והופכים לאדים. האדים עולים למעלה ויוצרים עננים גבוהים בשמיים.\nכשהעננים מתקררים, טיפות המים נופלות בחזרה כגשם. הגשם זורם בנחלים ומגיע שוב אל הים.\n\nפרק 2: צמחים\nהצמחים זקוקים לאור השמש כדי לייצר מזון. השורשים סופגים מים ומינרלים מהאדמה.\nהעלים הירוקים קולטים פחמן דו-חמצני מהאוויר ומשחררים חמצן לסביבה.'
  it('teacher: upload → text → topics → template draft → approve → draft quiz; AI says it is not available', async () => {
    URL.createObjectURL = () => 'blob:test'
    const source = new MockSource({ delayMs: 0 })
    const user = userEvent.setup({ applyAccept: false })
    render(<Providers source={source} session={sessionFor('u-t1')}><MemoryRouter initialEntries={['/teacher/materials']}><AppRoutes /></MemoryRouter></Providers>)
    await user.upload(await screen.findByLabelText(/^קובץ/), new File(['%PDF-1.4'], 'mayim.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'העלאה' }))
    expect(await screen.findByRole('heading', { name: /mayim/ })).toBeInTheDocument()
    const textArea = screen.getByLabelText('הטקסט (אפשר לתקן)')
    await user.click(textArea); await user.paste(TEXT)
    await user.click(screen.getByRole('button', { name: 'שמירת הטקסט' }))
    await user.click(await screen.findByRole('button', { name: 'חלוקה אוטומטית לנושאים' }))
    expect(screen.getByLabelText('שם נושא 1')).toHaveValue('מחזור המים')
    expect(screen.getByLabelText('שם נושא 2')).toHaveValue('צמחים')
    await user.click(screen.getByRole('button', { name: 'שמירת הנושאים' }))
    await user.click(await screen.findByRole('button', { name: 'יצירה עם AI' }))
    expect(await screen.findByRole('status')).toHaveTextContent('בהדגמה אין יצירה עם בינה מלאכותית')
    await user.click(screen.getByRole('button', { name: 'יצירה לפי תבנית (ללא AI)' }))
    expect(await screen.findByText('ממתין לבדיקה')).toBeInTheDocument()
    expect(screen.getByText('תבנית, ללא AI')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'אישור' }))
    await user.selectOptions(await screen.findByLabelText('לאיזו קבוצה'), 'g-math5')
    await user.click(screen.getByRole('button', { name: 'יצירת מבחן' }))
    const card = (await screen.findByRole('heading', { name: /מבחן: mayim/ })).closest('section')!
    expect(within(card).getByText('טיוטה')).toBeInTheDocument()                    // still needs publishing
  })
  it('shared material reaches the group\'s students read-only; students have no materials page', async () => {
    const source = new MockSource({ delayMs: 0 })
    const t = sessionFor('u-t1')
    const m = await source.uploadMaterial(t, new File(['x'], 'dapim.pdf', { type: 'application/pdf' }), 'דף מים')
    await expect(source.uploadMaterial(sessionFor('s-tamar'), new File(['x'], 'a.pdf', { type: 'application/pdf' }), 'x')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(source.shareMaterial(t, m.id, { groupId: 'g-eng' })).resolves.toBeUndefined()      // co-teacher of g-eng
    await expect(source.shareMaterial(t, m.id, { groupId: 'g-read' })).rejects.toBeInstanceOf(ForbiddenError)
    render(<Providers source={source} session={sessionFor('s-tamar')}><MemoryRouter initialEntries={['/student/tasks']}><AppRoutes /></MemoryRouter></Providers>)
    expect(await screen.findByText('📄 דף מים')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /חומרים/ })).not.toBeInTheDocument()
    expect((await source.materialDetail(sessionFor('s-tamar'), m.id)).text).toBeNull()
  })
})
