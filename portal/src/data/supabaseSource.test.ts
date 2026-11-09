// SupabaseSource against a FAKE supabase-js client (src/test/fakeSupabase.ts). What this proves: the portal calls
// the right Auth APIs / RPCs / functions, never reads closed columns, and turns every answer into the right
// error. What it cannot prove: how the real Supabase answers – that needs a real (local) Supabase.
import { SupabaseSource, toUserError } from './supabaseSource'
import { ForbiddenError, LoginError, ServerError } from './source'
import type { Session } from './types'
import { fakeSupabase } from '../test/fakeSupabase'
import type { FakeOptions } from '../test/fakeSupabase'

const A = 'a0000000-0000-4000-a000-000000000001', T = 'a0000000-0000-4000-a000-000000000011', P = 'a0000000-0000-4000-a000-000000000021'
const K1 = 'a0000000-0000-4000-a000-000000000031', K2 = 'a0000000-0000-4000-a000-000000000032'
const G = 'b0000000-0000-4000-b000-000000000101'

const tables = {
  profiles: [
    { id: A, full_name: 'מנהלת', avatar_path: null, status: 'active' }, { id: T, full_name: 'מורה', avatar_path: null, status: 'active' },
    { id: P, full_name: 'הורה', avatar_path: `${P}/me.png`, status: 'active' }, { id: K1, full_name: 'ילד אחד', avatar_path: null, status: 'active' },
    { id: K2, full_name: 'ילדה שתיים', avatar_path: null, status: 'active' }, { id: 'x-susp', full_name: 'מושעה', avatar_path: null, status: 'suspended' },
    { id: 'x-pend', full_name: 'ממתינה', avatar_path: null, status: 'active' },
  ],
  user_roles: [
    { user_id: A, role: 'admin', status: 'active' }, { user_id: A, role: 'parent', status: 'active' },
    { user_id: T, role: 'teacher', status: 'active' }, { user_id: P, role: 'parent', status: 'active' },
    { user_id: K1, role: 'student', status: 'active' }, { user_id: 'x-pend', role: 'teacher', status: 'pending' },
    { user_id: 'x-susp', role: 'parent', status: 'active' },
  ],
  students: [{ id: K1, grade: 'ב', login_mode: 'pin', birth_date: '2018-01-01', username: null }, { id: K2, grade: 'ה', login_mode: 'password', birth_date: '2015-01-01', username: 'k.two' }],
  guardianships: [{ parent_id: P, student_id: K1, relation: 'אמא', status: 'active' }, { parent_id: P, student_id: K2, relation: 'אמא', status: 'active' }],
  groups: [{ id: G, name: 'קבוצה', subject: 'math', grade: 'ב', archived_at: null, created_at: '2026-11-01' }],
  group_teachers: [{ group_id: G, teacher_id: T }],
  group_members: [{ group_id: G, student_id: K1, status: 'active' }],
  consents: [{ id: 'c1', student_id: K1, guardian_id: P, scope: 'group', group_id: G, granted_at: '2026-11-01', revoked_at: null }],
  invitations: [{ id: 'i1', group_id: G, invited_by: T, child_hint: 'ילדה', status: 'pending', created_at: '2026-11-08', contact_hash: 'h' }],
  learning_materials: [{ id: 'm1', owner_id: T, title: 'דף', storage_path: `${T}/a.pdf`, status: 'uploaded', created_at: '2026-11-02' }],
}
const users = { admin: { id: A }, teacher: { id: T }, parent: { id: P }, student: { id: K1 }, pending: { id: 'x-pend' }, susp: { id: 'x-susp' } }

function make(over: FakeOptions = {}) {
  const f = fakeSupabase({
    tables,
    signIn: email => {
      const u = { 'admin@t': users.admin, 'teacher@t': users.teacher, 'parent@t': users.parent, 'kid@t': users.student, 'pending@t': users.pending, 'susp@t': users.susp }[email]
      if (email === 'unconfirmed@t') return { error: 'Email not confirmed' }
      return u ? { user: u } : { error: 'Invalid login credentials' }
    },
    tokens: { 'tok-k1': users.student },
    ...over,
  })
  return { ...f, src: new SupabaseSource(f.client, 'http://localhost:5173/') }
}
const sess = (userId: string, role: Session['role']): Session => ({ userId, role, fullName: '', avatar: '' })

beforeEach(() => localStorage.clear())

describe('adult sign-in (Supabase Auth)', () => {
  it('picks the strongest ACTIVE role and signs the picture URL', async () => {
    const { src } = make()
    expect(await src.signInAdult('admin@t', 'pw')).toMatchObject({ userId: A, role: 'admin' })
    expect((await src.signInAdult('parent@t', 'pw')).avatar).toBe(`https://signed.test/${P}/me.png`)
  })
  it('explains wrong credentials and unconfirmed e-mail', async () => {
    const { src } = make()
    await expect(src.signInAdult('nobody@t', 'pw')).rejects.toThrow('הדוא״ל או הסיסמה לא נכונים')
    await expect(src.signInAdult('unconfirmed@t', 'pw')).rejects.toThrow('לאשר את כתובת הדוא״ל')
  })
  it('a pending teacher, a suspended user and a student are signed out again', async () => {
    const { src, calls } = make()
    await expect(src.signInAdult('pending@t', 'pw')).rejects.toThrow('ממתין לאישור')
    await expect(src.signInAdult('susp@t', 'pw')).rejects.toThrow('מושעה')
    await expect(src.signInAdult('kid@t', 'pw')).rejects.toThrow('תלמידים נכנסים')
    expect(calls.auth.filter(c => c.op === 'signOut')).toHaveLength(3)
  })
  it('first sign-in after confirming: asks the SERVER for the role chosen at sign-up', async () => {
    const newUser = { id: 'n1', user_metadata: { requested_role: 'teacher' } }
    const { src, calls } = make({
      tables: { ...tables, profiles: [...tables.profiles, { id: 'n1', full_name: 'חדשה', avatar_path: null, status: 'active' }] },
      signIn: () => ({ user: newUser }),
      rpc: { request_role: () => ({ data: 'pending' }) },
    })
    await expect(src.signInAdult('new@t', 'pw')).rejects.toThrow('לחשבון הזה אין עדיין הרשאה')   // fake rpc does not add the row
    expect(calls.rpc).toEqual([{ fn: 'request_role', args: { p_role: 'teacher' } }])
  })
  it('sign-up sends the e-mail confirmation link back to the portal; the role is only a request', async () => {
    const { src, calls } = make()
    expect(await src.signUpAdult({ fullName: ' דנה ', email: ' d@t ', password: '12345678', role: 'teacher' })).toEqual({ needsEmailConfirmation: true })
    expect(calls.auth[0]).toEqual({ op: 'signUp', args: { email: 'd@t', password: '12345678',
      options: { emailRedirectTo: 'http://localhost:5173/', data: { full_name: 'דנה', requested_role: 'teacher' } } } })
    await expect(src.signUpAdult({ fullName: 'x', email: 'e@t', password: 'short', role: 'parent' })).rejects.toThrow('8 תווים')
  })
  it('password reset answers the same whether or not the address exists', async () => {
    const { src, calls } = make()
    await expect(src.requestPasswordReset('nobody@t')).resolves.toBeUndefined()   // the fake API says "User not found"
    expect(calls.auth[0]).toEqual({ op: 'resetPasswordForEmail', args: { email: 'nobody@t', redirectTo: 'http://localhost:5173/' } })
  })
})

describe('student sign-in (student-login function → Supabase session)', () => {
  it('a PIN needs this device to be approved – otherwise nothing is sent', async () => {
    const { src, calls } = make()
    await expect(src.signInPin(K1, '480317')).rejects.toThrow('המכשיר הזה לא אושר')
    expect(calls.invoke).toHaveLength(0)
  })
  it('the session from the function is handed to Supabase Auth (setSession), not kept by us', async () => {
    const { src, calls } = make({ functions: { 'student-login': () => ({ body: { session: { access_token: 'tok-k1', refresh_token: 'r', expires_in: 3600 } } }) } })
    localStorage.setItem('masa-device-tokens', JSON.stringify({ [K1]: 'd'.repeat(64) }))
    expect(await src.signInPin(K1, '480317')).toMatchObject({ userId: K1, role: 'student' })
    expect(calls.invoke[0]).toEqual({ name: 'student-login', body: { mode: 'pin', studentId: K1, pin: '480317', deviceToken: 'd'.repeat(64) } })
    expect(calls.auth.find(c => c.op === 'setSession')).toEqual({ op: 'setSession', args: { access_token: 'tok-k1', refresh_token: 'r' } })
  })
  it('shows the server\'s message, remaining attempts and lock state', async () => {
    let reply: { status: number; body: Record<string, unknown> } = { status: 401, body: { error: 'wrong', message: 'הפרטים לא נכונים. נסו שוב', remaining: 3 } }
    const { src } = make({ functions: { 'student-login': () => reply } })
    const e1 = await src.signInPassword('k.two', 'bad').catch(e => e)
    expect(e1).toBeInstanceOf(LoginError)
    expect(e1.message).toBe('הפרטים לא נכונים. נסו שוב')
    expect(e1.detail).toEqual({ ok: true, remaining: 3 })
    reply = { status: 423, body: { error: 'needs_parent', message: 'החשבון נעול. צריך שהורה ישחרר אותו' } }
    expect((await src.signInPassword('k.two', 'bad').catch(e => e)).detail).toEqual({ ok: false, reason: 'needs_parent' })
  })
  it('a session that Supabase Auth does not accept is not used', async () => {
    const { src } = make({ functions: { 'student-login': () => ({ body: { session: { access_token: 'forged', refresh_token: 'r', expires_in: 1 } } }) } })
    await expect(src.signInPassword('k.two', 'pw')).rejects.toBeInstanceOf(ServerError)
  })
  it('the picture grid sends only this device\'s tokens', async () => {
    const { src, calls } = make({ functions: { 'student-login': () => ({ body: { profiles: [{ id: K1, firstName: 'ילד', avatarPath: null }] } }) } })
    expect(await src.pinProfiles()).toEqual([])              // no approved device → no request at all
    expect(calls.invoke).toHaveLength(0)
    localStorage.setItem('masa-device-tokens', JSON.stringify({ [K1]: 'd'.repeat(64) }))
    expect((await src.pinProfiles()).map(p => p.firstName)).toEqual(['ילד'])
    expect(calls.invoke[0].body).toEqual({ mode: 'profiles', deviceTokens: ['d'.repeat(64)] })
  })
})

describe('parent actions', () => {
  it('approving this device stores the device token locally (the server keeps only its hash)', async () => {
    const { src, calls } = make({ rpc: { enroll_device: () => ({ data: 'e'.repeat(64) }) } })
    await src.enrollThisDevice(sess(P, 'parent'), K1)
    expect(calls.rpc[0].fn).toBe('enroll_device')
    expect(JSON.parse(localStorage.getItem('masa-device-tokens')!)).toEqual({ [K1]: 'e'.repeat(64) })
  })
  it('creating a child goes through the manage-student function; its refusals reach the parent', async () => {
    let reply: { status?: number; body?: Record<string, unknown> } = { status: 403, body: { message: 'רק הורה שאימת דוא״ל וטלפון יכול ליצור חשבון לילד' } }
    const { src, calls } = make({ functions: { 'manage-student': () => reply } })
    const input = { fullName: 'ילד', birthDate: '2019-01-01', grade: 'א' as const, relation: 'אמא' as const, loginMode: 'pin' as const, pin: '480317' }
    await expect(src.createChild(sess(P, 'parent'), input)).rejects.toBeInstanceOf(ForbiddenError)
    reply = { status: 409, body: { message: 'כבר יש לך ילד עם אותו שם ותאריך לידה' } }
    await expect(src.createChild(sess(P, 'parent'), input)).rejects.toThrow('כבר יש לך ילד')
    reply = { body: { studentId: 'new-kid' } }
    expect(await src.createChild(sess(P, 'parent'), input)).toEqual({ studentId: 'new-kid' })
    expect(calls.invoke[0].body).toMatchObject({ action: 'create', loginMode: 'pin' })
  })
  it('invitations go through the server functions', async () => {
    const { src, calls } = make({ rpc: { create_invitation: () => ({ data: 'inv-new' }) } })
    expect((await src.inviteParent(sess(T, 'teacher'), G, ' p@t ', 'ילדה')).id).toBe('inv-new')
    await src.respondInvitation(sess(P, 'parent'), 'i1', true, K2)
    expect(calls.rpc).toEqual([
      { fn: 'create_invitation', args: { p_group: G, p_parent_email: 'p@t', p_child_hint: 'ילדה' } },
      { fn: 'respond_invitation', args: { p_invitation: 'i1', p_accept: true, p_student: K2 } },
    ])
  })
})

describe('reads', () => {
  it('no screen ever asks for a closed column (birth date, username, e-mail hash, device token)', async () => {
    const { src, calls } = make()
    await src.listAdults(); await src.listStudents(); await src.listGroups()
    await src.myGroups(sess(T, 'teacher')); await src.groupDetail(sess(T, 'teacher'), G); await src.myStudents(sess(T, 'teacher'))
    await src.myInvitations(sess(T, 'teacher')); await src.myMaterials(sess(T, 'teacher'))
    await src.myChildren(sess(P, 'parent')); await src.parentInvitations()
    expect(calls.selects.length).toBeGreaterThan(10)
    for (const q of calls.selects) {
      expect(q.cols, q.table).not.toMatch(/\*|birth_date|username|contact_hash|token_hash/)
    }
  })
  it('maps rows to the screens\' shapes', async () => {
    const { src } = make()
    const kids = await src.myChildren(sess(P, 'parent'))
    expect(kids.map(k => [k.student.fullName, k.student.grade, k.groups.length, k.consents.length])).toEqual([['ילד אחד', 'ב', 1, 1], ['ילדה שתיים', 'ה', 0, 0]])
    expect((await src.groupDetail(sess(T, 'teacher'), G)).students.map(s => s.fullName)).toEqual(['ילד אחד'])
    expect((await src.listAdults()).find(a => a.id === 'x-susp')?.status).toBe('suspended')
  })
  it('a group the user may not see is reported as such', async () => {
    const { src } = make()
    await expect(src.groupDetail(sess(T, 'teacher'), 'other')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('errors a user can read', () => {
  it('maps permission errors, network errors and the rest', () => {
    expect(toUserError({ code: '42501', message: 'permission denied for table students' })).toBeInstanceOf(ForbiddenError)
    expect(toUserError({ message: 'new row violates row-level security policy' })).toBeInstanceOf(ForbiddenError)
    expect(toUserError(new TypeError('Failed to fetch')).message).toMatch('אין חיבור לשרת')
    const other = toUserError({ code: 'XX000', message: 'relation "student_credentials" secret_hash …' })
    expect(other).toBeInstanceOf(ServerError)
    expect(other.message).not.toMatch(/secret|student_credentials/)
  })
})

describe('learning (phase 3)', () => {
  const quizTables = {
    ...tables,
    assignments: [{ id: 'q1', group_id: G, title: 'חידון', instructions: '', kind: 'quiz', player_path: null, status: 'published', due_at: null, created_at: '2026-11-09' }],
    assignment_items: [{ id: 'it1', assignment_id: 'q1', position: 1, prompt: 'שאלה', options: ['א', 'ב'] }],
    assignment_answer_keys: [{ item_id: 'it1', answer_index: 1 }],
    assignment_status: [{ assignment_id: 'q1', student_id: K1, state: 'completed', practice_questions: 0, practice_first_try: 0, verified_score: 1, verified_max: 1, attempts: 1, last_activity_at: null }],
  }
  it('a student\'s quiz never asks for the answer keys; a teacher\'s does', async () => {
    const { src, calls } = make({ tables: quizTables })
    const kid = await src.assignmentDetail(sess(K1, 'student'), 'q1')
    expect(kid.items![0].answerIndex).toBeUndefined()
    expect(calls.selects.some(q => q.table === 'assignment_answer_keys')).toBe(false)
    const teacher = await src.assignmentDetail(sess(T, 'teacher'), 'q1')
    expect(teacher.items![0].answerIndex).toBe(1)
  })
  it('learning goes through the server functions; the client never sends a score', async () => {
    const { src, calls } = make({ rpc: { start_session: () => ({ data: 'sess-1' }), record_progress: () => ({ data: 2 }),
      submit_quiz: () => ({ data: { score: 1, max: 1, attempt: 1, attempts_left: 2, late: false } }) } })
    const kid = sess(K1, 'student')
    expect(await src.startSession(kid, 'q1')).toBe('sess-1')
    await src.recordProgress(kid, 'sess-1', [{ id: 'e1', kind: 'question', ok: true }])
    expect(await src.submitQuiz(kid, 'q1', [1])).toEqual({ score: 1, max: 1, attempt: 1, attemptsLeft: 2, late: false })
    expect(calls.rpc.map(c => c.fn)).toEqual(['start_session', 'record_progress', 'submit_quiz'])
    expect(calls.rpc[2].args).toEqual({ p_assignment: 'q1', p_answers: [1] })
    expect(JSON.stringify(calls.rpc)).not.toMatch(/score/)
  })
  it('creating a quiz writes questions and keys; the group page shows verified status', async () => {
    const { src, calls } = make({ tables: quizTables })
    await src.createAssignment(sess(T, 'teacher'), { groupId: G, title: 'חדש', instructions: '', kind: 'quiz', items: [{ position: 1, prompt: 'q', options: ['a', 'b'], answerIndex: 0 }] })
    expect(calls.inserts.map(i => i.table)).toEqual(['assignments', 'assignment_items', 'assignment_answer_keys'])
    const d = await src.groupDetail(sess(T, 'teacher'), G)
    expect(d.progress.find(p => p.assignmentId === 'q1')).toMatchObject({ state: 'completed', verifiedScore: 1, verifiedMax: 1 })
  })
})

describe('materials (phase 4)', () => {
  it('upload: the server decides the path; the file goes exactly there; a failed upload leaves no record', async () => {
    const r = { id: 'mat-1', path: `${T}/mat-1/source.pdf` }
    const ok = make({ rpc: { create_material: () => ({ data: r }) }, tables: { ...tables, learning_materials: [{ id: 'mat-1', owner_id: T, title: 'דף', storage_path: r.path, status: 'uploaded', created_at: '2026-11-10' }] } })
    await ok.src.uploadMaterial(sess(T, 'teacher'), new File(['%PDF'], 'evil/../name.pdf', { type: 'application/pdf' }), 'דף')
    expect(ok.calls.rpc[0]).toEqual({ fn: 'create_material', args: { p_title: 'דף', p_mime: 'application/pdf', p_size: 4 } })
    expect(ok.calls.uploads).toEqual([{ bucket: 'materials', path: r.path, contentType: 'application/pdf', upsert: false }])
    const bad = make({ rpc: { create_material: () => ({ data: r }) }, uploadError: 'new row violates row-level security policy',
      tables: { ...tables, learning_materials: [{ id: 'mat-1', owner_id: T, title: 'דף', storage_path: r.path }] } })
    await expect(bad.src.uploadMaterial(sess(T, 'teacher'), new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }), 'דף')).rejects.toBeInstanceOf(ForbiddenError)
    expect(bad.tables.learning_materials).toHaveLength(0)
  })
  it('a reader who is not the owner never asks for the text, topics or drafts', async () => {
    const { src, calls } = make({ tables: { ...tables, learning_materials: [{ id: 'mat-1', owner_id: T, title: 'דף', storage_path: 'x', status: 'uploaded', created_at: '2026-11-10' }], material_shares: [] } })
    const d = await src.materialDetail(sess(K1, 'student'), 'mat-1')
    expect(d.owner).toBe(false); expect(d.text).toBeNull()
    expect(calls.rpc.some(c => c.fn === 'material_text')).toBe(false)
    expect(calls.selects.some(q => ['material_topics', 'content_drafts'].includes(q.table))).toBe(false)
    expect(calls.selects.some(q => /extracted_text/.test(q.cols))).toBe(false)
  })
  it('AI: the server\'s "not configured" answer reaches the user as is; nothing is pretended', async () => {
    const { src } = make({ functions: { 'generate-content': () => ({ status: 503, body: { error: 'ai_unavailable', message: 'יצירה עם בינה מלאכותית לא מוגדרת בשרת הזה' } }) } })
    await expect(src.requestAiDraft(sess(T, 'teacher'), 'mat-1', { subjectName: 'מדעים', grade: 'ה' })).rejects.toThrow('לא מוגדרת')
  })
})
