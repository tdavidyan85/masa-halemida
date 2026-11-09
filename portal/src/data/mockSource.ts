// Local, in-memory data source with FICTIONAL data. It imitates the planned server rules (who may see what)
// so the screens behave like the real thing – but it runs in the browser and protects nothing.
import * as D from './mockData'
import { AttemptLimiter } from '../auth/attemptLimiter'
import { ForbiddenError, LoginError } from './source'
import type { ChildOverview, DataSource, GroupDetail, PinProfile, StudentTask } from './source'
import type { Adult, Group, Invitation, Role, Session, Student } from './types'

export interface MockOptions { delayMs?: number; failWith?: string }

const clone = <T,>(x: T): T => structuredClone(x)

export class MockSource implements DataSource {
  readonly kind = 'mock' as const
  private adults = clone(D.ADULTS)
  private students = clone(D.STUDENTS)
  private groups = clone(D.GROUPS)
  private guardianships = clone(D.GUARDIANSHIPS)
  private invitations = clone(D.INVITATIONS)
  private consents = clone(D.CONSENTS)
  private materials = clone(D.MATERIALS)
  private assignments = clone(D.ASSIGNMENTS)
  private progress = clone(D.ASSIGNMENT_PROGRESS)
  private subjects = clone(D.SUBJECT_PROGRESS)
  readonly limiter = new AttemptLimiter()

  constructor(private opts: MockOptions = {}) {}

  private async wait<T>(value: T): Promise<T> {
    if (this.opts.delayMs) await new Promise(r => setTimeout(r, this.opts.delayMs))
    if (this.opts.failWith) throw new Error(this.opts.failWith)
    return clone(value)
  }
  private need(s: Session, ...roles: Role[]) { if (!roles.includes(s.role)) throw new ForbiddenError() }
  private session(p: Adult | Student): Session { return { userId: p.id, role: p.role, fullName: p.fullName, avatar: p.avatar } }
  private group(id: string): Group {
    const g = this.groups.find(x => x.id === id)
    if (!g) throw new Error('הקבוצה לא נמצאה')
    return g
  }
  private teaches(s: Session, g: Group) { return g.teacherIds.includes(s.userId) }
  private childrenOf(parentId: string) { return this.guardianships.filter(x => x.parentId === parentId) }

  // ---------- sign-in ----------
  async signInAdult(email: string, password: string) {
    const u = this.adults.find(x => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u || password !== D.DEMO_PASSWORD) throw new LoginError('הדוא״ל או הסיסמה לא נכונים')
    if (u.status === 'pending') throw new LoginError('החשבון ממתין לאישור מנהל המערכת')
    if (u.status === 'suspended') throw new LoginError('החשבון מושעה. פנו למנהל המערכת')
    return this.wait(this.session(u))
  }
  async pinProfiles(): Promise<PinProfile[]> {
    return this.wait(this.students.filter(x => x.loginMode === 'pin')
      .map(x => ({ id: x.id, firstName: x.fullName.split(' ')[0], avatar: x.avatar })))
  }
  async signInPin(studentId: string, pin: string) {
    const st = this.students.find(x => x.id === studentId && x.loginMode === 'pin')
    const key = 'pin:' + studentId
    const before = this.limiter.check(key)
    if (!before.ok) throw new LoginError(before.reason === 'needs_parent' ? 'החשבון נעול. צריך שהורה ישחרר אותו' : 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה', before)
    if (!st || pin !== D.DEMO_PIN) {
      const r = this.limiter.fail(key)
      throw new LoginError(r.ok ? 'הקוד לא נכון. נסו שוב' : r.reason === 'needs_parent' ? 'החשבון נעול. צריך שהורה ישחרר אותו' : 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה', r)
    }
    this.limiter.succeed(key)
    return this.wait(this.session(st))
  }
  async signInPassword(username: string, password: string) {
    const key = 'pw:' + username.trim().toLowerCase()
    const before = this.limiter.check(key)
    if (!before.ok) throw new LoginError(before.reason === 'needs_parent' ? 'החשבון נעול. צריך שהורה ישחרר אותו' : 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה', before)
    const st = this.students.find(x => x.loginMode === 'password' && x.username === username.trim().toLowerCase())
    if (!st || password !== D.DEMO_PASSWORD) {
      const r = this.limiter.fail(key)
      throw new LoginError(r.ok ? 'שם המשתמש או הסיסמה לא נכונים' : 'יותר מדי ניסיונות. נסו שוב מאוחר יותר', r)
    }
    this.limiter.succeed(key)
    return this.wait(this.session(st))
  }

  // ---------- admin ----------
  async listAdults(s: Session) { this.need(s, 'admin'); return this.wait(this.adults) }
  async listStudents(s: Session) { this.need(s, 'admin'); return this.wait(this.students) }
  async listGroups(s: Session) { this.need(s, 'admin'); return this.wait(this.groups) }
  async setAdultStatus(s: Session, id: string, status: Adult['status']) {
    this.need(s, 'admin')
    const u = this.adults.find(x => x.id === id)
    if (!u) throw new Error('המשתמש לא נמצא')
    if (u.id === s.userId) throw new ForbiddenError('אי אפשר לשנות את החשבון של עצמך')
    u.status = status
    return this.wait(u)
  }

  // ---------- teacher ----------
  async myGroups(s: Session) { this.need(s, 'teacher'); return this.wait(this.groups.filter(g => this.teaches(s, g))) }
  async groupDetail(s: Session, groupId: string): Promise<GroupDetail> {
    this.need(s, 'teacher', 'admin')
    const group = this.group(groupId)
    if (s.role === 'teacher' && !this.teaches(s, group)) throw new ForbiddenError('הקבוצה הזאת לא שלך')
    const assignments = this.assignments.filter(x => x.groupId === groupId)
    return this.wait({
      group,
      teachers: this.adults.filter(x => group.teacherIds.includes(x.id)),
      students: this.students.filter(x => group.studentIds.includes(x.id)),
      assignments,
      progress: this.progress.filter(p => assignments.some(x => x.id === p.assignmentId) && group.studentIds.includes(p.studentId)),
    })
  }
  async myStudents(s: Session) {
    this.need(s, 'teacher')
    const mine = this.groups.filter(g => this.teaches(s, g) && !g.archived)
    const ids = new Set(mine.flatMap(g => g.studentIds))
    return this.wait(this.students.filter(x => ids.has(x.id)).map(x => ({ ...x, groups: mine.filter(g => g.studentIds.includes(x.id)) })))
  }
  async myAssignments(s: Session) {
    this.need(s, 'teacher')
    const mine = this.groups.filter(g => this.teaches(s, g))
    return this.wait(this.assignments.filter(a => mine.some(g => g.id === a.groupId)).map(a => ({ ...a, group: this.group(a.groupId) })))
  }
  async myMaterials(s: Session) { this.need(s, 'teacher'); return this.wait(this.materials.filter(m => m.ownerId === s.userId)) }
  async myInvitations(s: Session) {
    this.need(s, 'teacher')
    return this.wait(this.invitations.filter(i => i.invitedBy === s.userId).map(i => ({ ...i, group: this.group(i.groupId) })))
  }
  async createGroup(s: Session, input: Pick<Group, 'name' | 'subject' | 'grade'>) {
    this.need(s, 'teacher')
    if (!input.name.trim()) throw new Error('צריך לתת שם לקבוצה')
    const g: Group = { id: 'g-' + Math.random().toString(36).slice(2, 8), ...input, name: input.name.trim(), teacherIds: [s.userId], studentIds: [] }
    this.groups.push(g)
    return this.wait(g)
  }
  async inviteParent(s: Session, groupId: string, parentEmail: string, childHint: string) {
    this.need(s, 'teacher')
    const g = this.group(groupId)
    if (!this.teaches(s, g)) throw new ForbiddenError('הקבוצה הזאת לא שלך')
    const parent = this.adults.find(x => x.role === 'parent' && x.email === parentEmail.trim().toLowerCase())
    // a real system sends the invitation to the address even if no account exists yet; the demo needs a known parent
    if (!parent) throw new Error('בהדגמה אפשר להזמין רק הורה מרשימת הדוגמה (למשל ronit@demo.local)')
    const inv: Invitation = { id: 'inv-' + Math.random().toString(36).slice(2, 8), groupId, invitedBy: s.userId, parentId: parent.id,
      childHint: childHint.trim(), status: 'pending', sentAt: new Date().toISOString().slice(0, 10) }
    this.invitations.push(inv)
    return this.wait(inv)
  }

  // ---------- parent ----------
  async myChildren(s: Session): Promise<ChildOverview[]> {
    this.need(s, 'parent')
    return this.wait(this.childrenOf(s.userId).map(gs => {
      const student = this.students.find(x => x.id === gs.studentId)!
      const groups = this.groups.filter(g => g.studentIds.includes(student.id) && !g.archived)
      return {
        student, relation: gs.relation, groups,
        subjects: this.subjects.filter(x => x.studentId === student.id),
        assignments: this.assignments.filter(a => groups.some(g => g.id === a.groupId))
          .map(a => ({ ...a, progress: this.progress.find(p => p.assignmentId === a.id && p.studentId === student.id) })),
        consents: this.consents.filter(c => c.studentId === student.id),
      }
    }))
  }
  async parentInvitations(s: Session) {
    this.need(s, 'parent')
    return this.wait(this.invitations.filter(i => i.parentId === s.userId)
      .map(i => ({ ...i, group: this.group(i.groupId), teacher: this.adults.find(x => x.id === i.invitedBy)! })))
  }
  async respondInvitation(s: Session, invitationId: string, approve: boolean, childId?: string) {
    this.need(s, 'parent')
    const inv = this.invitations.find(i => i.id === invitationId && i.parentId === s.userId)
    if (!inv) throw new ForbiddenError('ההזמנה לא נמצאה')
    if (inv.status !== 'pending') throw new Error('ההזמנה כבר טופלה או שפג תוקפה')
    if (approve) {
      if (!childId || !this.childrenOf(s.userId).some(x => x.studentId === childId)) throw new ForbiddenError('אפשר לצרף רק ילד שלך')
      const g = this.group(inv.groupId)
      if (!g.studentIds.includes(childId)) g.studentIds.push(childId)
      this.consents.push({ id: 'c-' + Math.random().toString(36).slice(2, 8), studentId: childId, parentId: s.userId, scope: 'group',
        groupId: g.id, grantedAt: new Date().toISOString().slice(0, 10) })
    }
    inv.status = approve ? 'approved' : 'declined'
    return this.wait(inv)
  }
  async releaseLock(s: Session, studentId: string) {
    this.need(s, 'parent')
    if (!this.childrenOf(s.userId).some(x => x.studentId === studentId)) throw new ForbiddenError('אפשר לשחרר רק חשבון של ילד שלך')
    const st = this.students.find(x => x.id === studentId)!
    this.limiter.release(st.loginMode === 'pin' ? 'pin:' + st.id : 'pw:' + st.username)
    await this.wait(null)
  }

  // ---------- student: only their own data ----------
  async myTasks(s: Session): Promise<StudentTask[]> {
    this.need(s, 'student')
    const groups = this.groups.filter(g => g.studentIds.includes(s.userId) && !g.archived)
    return this.wait(this.assignments.filter(a => groups.some(g => g.id === a.groupId)).map(a => ({
      ...a, group: groups.find(g => g.id === a.groupId)!,
      progress: this.progress.find(p => p.assignmentId === a.id && p.studentId === s.userId),
    })))
  }
  async myProgress(s: Session) { this.need(s, 'student'); return this.wait(this.subjects.filter(x => x.studentId === s.userId)) }
}
