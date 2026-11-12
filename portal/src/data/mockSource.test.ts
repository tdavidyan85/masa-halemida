// The access rules the screens rely on. The real backend must pass the same cases (as RLS tests).
import { MockSource } from './mockSource'
import { ForbiddenError, LoginError } from './source'
import { DEMO_PASSWORD, DEMO_PIN } from './mockData'
import { loadDataSource } from '.'
import { ConfigError } from './config'

const src = () => new MockSource()
const signIn = (email: string) => src().signInAdult(email, DEMO_PASSWORD)

describe('sign-in', () => {
  it('adults sign in with the demo password only', async () => {
    await expect(signIn('michal@demo.local')).resolves.toMatchObject({ role: 'teacher', fullName: 'מיכל ברק' })
    await expect(src().signInAdult('michal@demo.local', 'wrong')).rejects.toBeInstanceOf(LoginError)
  })
  it('a teacher waiting for approval cannot sign in', async () => {
    await expect(signIn('yael@demo.local')).rejects.toThrow('ממתין לאישור')
  })
  it('PIN: 5 wrong codes lock the account, even for the right code', async () => {
    const s = src()
    for (let i = 0; i < 5; i++) await expect(s.signInPin('s-noam', '000000')).rejects.toBeInstanceOf(LoginError)
    await expect(s.signInPin('s-noam', DEMO_PIN)).rejects.toThrow('יותר מדי ניסיונות')
  })
  it('PIN works only for PIN students; passwords only for password students', async () => {
    const s = src()
    await expect(s.signInPin('s-noam', DEMO_PIN)).resolves.toMatchObject({ role: 'student', userId: 's-noam' })
    await expect(s.signInPin('s-tamar', DEMO_PIN)).rejects.toBeInstanceOf(LoginError)
    await expect(s.signInPassword('tamar.levi', DEMO_PASSWORD)).resolves.toMatchObject({ userId: 's-tamar' })
  })
  it('a parent releases a locked child', async () => {
    const s = src()
    for (let i = 0; i < 5; i++) await s.signInPin('s-noam', '000000').catch(() => {})
    await expect(s.signInPin('s-noam', DEMO_PIN)).rejects.toThrow('יותר מדי ניסיונות')
    const parent = await s.signInAdult('ronit@demo.local', DEMO_PASSWORD)
    await s.releaseLock(parent, 's-noam')
    await expect(s.signInPin('s-noam', DEMO_PIN)).resolves.toMatchObject({ userId: 's-noam' })
  })
  it('a parent cannot release someone else\'s child', async () => {
    const s = src()
    const parent = await s.signInAdult('ronit@demo.local', DEMO_PASSWORD)
    await expect(s.releaseLock(parent, 's-itay')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('who sees what', () => {
  it('a teacher sees only her own groups and students', async () => {
    const s = src(), t = await s.signInAdult('dana@demo.local', DEMO_PASSWORD)
    const groups = await s.myGroups(t)
    expect(groups.map(g => g.id).sort()).toEqual(['g-eng', 'g-read'])
    const students = await s.myStudents(t)
    expect(students.map(x => x.id)).not.toContain('s-lior') // only in Michal's math group
    await expect(s.groupDetail(t, 'g-math5')).rejects.toBeInstanceOf(ForbiddenError)
  })
  it('a teacher cannot use the admin or parent functions', async () => {
    const s = src(), t = await s.signInAdult('michal@demo.local', DEMO_PASSWORD)
    await expect(s.listAdults(t)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(s.myChildren(t)).rejects.toBeInstanceOf(ForbiddenError)
  })
  it('a student sees only their own tasks and progress', async () => {
    const s = src(), st = await s.signInPassword('tamar.levi', DEMO_PASSWORD)
    const tasks = await s.myTasks(st)
    expect(new Set(tasks.map(t => t.groupId))).toEqual(new Set(['g-math5', 'g-eng']))
    expect(tasks.every(t => !t.progress || t.progress.studentId === 's-tamar')).toBe(true)
    expect((await s.myProgress(st)).every(p => p.studentId === 's-tamar')).toBe(true)
  })
  it('a student cannot read other people or change anything', async () => {
    const s = src(), st = await s.signInPin('s-noam', DEMO_PIN)
    await expect(s.listStudents(st)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(s.myStudents(st)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(s.createGroup(st, { name: 'x', subject: 'math', grade: 'ב' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(s.setAdultStatus(st, 'u-t1', 'suspended')).rejects.toBeInstanceOf(ForbiddenError)
  })
  it('a parent sees all their children, in every subject', async () => {
    const s = src(), p = await s.signInAdult('ronit@demo.local', DEMO_PASSWORD)
    const kids = await s.myChildren(p)
    expect(kids.map(k => k.student.id).sort()).toEqual(['s-noam', 's-tamar'])
    expect(kids.find(k => k.student.id === 's-tamar')!.subjects.map(x => x.subject).sort()).toEqual(['english', 'math'])
  })
})

describe('invitations and consent', () => {
  it('a child joins a group only after the parent approves, and a consent is recorded', async () => {
    const s = src()
    const teacher = await s.signInAdult('michal@demo.local', DEMO_PASSWORD)
    const parent = await s.signInAdult('ronit@demo.local', DEMO_PASSWORD)
    expect((await s.groupDetail(teacher, 'g-math5')).students.map(x => x.id)).not.toContain('s-noam')
    await s.respondInvitation(parent, 'inv-1', true, 's-noam')
    expect((await s.groupDetail(teacher, 'g-math5')).students.map(x => x.id)).toContain('s-noam')
    const noam = (await s.myChildren(parent)).find(k => k.student.id === 's-noam')!
    expect(noam.consents.some(c => c.scope === 'group' && c.groupId === 'g-math5')).toBe(true)
  })
  it('a parent can attach only their own child, and only once', async () => {
    const s = src(), parent = await s.signInAdult('ronit@demo.local', DEMO_PASSWORD)
    await expect(s.respondInvitation(parent, 'inv-1', true, 's-itay')).rejects.toBeInstanceOf(ForbiddenError)
    await s.respondInvitation(parent, 'inv-1', false)
    await expect(s.respondInvitation(parent, 'inv-1', true, 's-noam')).rejects.toThrow('כבר טופלה')
  })
  it('a parent cannot answer someone else\'s invitation', async () => {
    const s = src(), parent = await s.signInAdult('ronit@demo.local', DEMO_PASSWORD)
    await expect(s.respondInvitation(parent, 'inv-2', true, 's-noam')).rejects.toBeInstanceOf(ForbiddenError)
  })
  it('a teacher invites only into her own group', async () => {
    const s = src(), t = await s.signInAdult('dana@demo.local', DEMO_PASSWORD)
    await expect(s.inviteParent(t, 'g-math5', 'ronit@demo.local', 'נועם')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(s.inviteParent(t, 'g-read', 'ronit@demo.local', 'נועם')).resolves.toMatchObject({ status: 'pending' })
  })
})

describe('data source selection', () => {
  it('uses the mock source by default', async () => {
    expect((await loadDataSource({})).kind).toBe('mock')
  })
  it('refuses "supabase" without complete settings (no silent fallback to demo)', async () => {
    await expect(loadDataSource({ VITE_DATA_SOURCE: 'supabase' })).rejects.toBeInstanceOf(ConfigError)
  })
})
