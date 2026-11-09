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
    expect(within(table).getAllByText(/הושלם/).length).toBeGreaterThan(0)
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
