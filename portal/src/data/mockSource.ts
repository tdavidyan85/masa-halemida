// Local, in-memory data source with FICTIONAL data. It imitates the planned server rules (who may see what)
// so the screens behave like the real thing – but it runs in the browser and protects nothing.
import * as D from './mockData'
import { AttemptLimiter } from '../auth/attemptLimiter'
import { DemoOnlyError, ForbiddenError, LoginError } from './source'
import type { AssignmentInput, ChildOverview, DataSource, GroupDetail, NewChildInput, PinProfile, SessionEvent, SignUpInput, StudentTask } from './source'
import type { Adult, Assignment, ContentDraft, Group, Invitation, LearningSession, Material, MaterialShare, MaterialTopic, PracticeEvent, QuizResult, Role, Session, Student } from './types'
import { checkPack, templatePack } from '../../../supabase/functions/_shared/content'
import { ACCEPTED, MAX_BYTES } from '../materials/extract'

export interface MockOptions { delayMs?: number; failWith?: string }

/** the demo session lives in this browser tab only (sessionStorage) and holds only fictional people */
const SESSION_KEY = 'masa-portal-demo-session'

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
  private sessions = clone(D.SESSIONS)
  private eventIds = new Set<string>()
  private attempts = new Map<string, number>()
  private files = new Map<string, string>()                 // material id → object URL (this tab only)
  private texts = new Map<string, string>()
  private topics = new Map<string, MaterialTopic[]>()
  private drafts: ContentDraft[] = []
  private shares: (MaterialShare & { materialId: string })[] = []
  readonly limiter = new AttemptLimiter()
  private listeners = new Set<(s: Session | null, e: SessionEvent) => void>()

  constructor(private opts: MockOptions = {}) {}

  // ---------- session (demo) ----------
  private remember(s: Session | null, e: SessionEvent) {
    try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY) } catch { /* private mode */ }
    this.listeners.forEach(l => l(s, e))
    return s
  }
  async currentSession(): Promise<Session | null> {
    try { const v = sessionStorage.getItem(SESSION_KEY); return v ? JSON.parse(v) as Session : null } catch { return null }
  }
  onSessionChange(cb: (s: Session | null, e: SessionEvent) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  async signOut() { this.remember(null, 'signed_out') }

  // ---------- server-only actions ----------
  async signUpAdult(_input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }> { throw new DemoOnlyError('בהדגמה לא נוצרים חשבונות. אפשר להיכנס עם החשבונות לדוגמה.') }
  async requestPasswordReset(_email: string): Promise<void> { throw new DemoOnlyError('בהדגמה אין שחזור סיסמה. הסיסמה לכל החשבונות לדוגמה היא demo1234.') }
  async updatePassword(_pw: string): Promise<void> { throw new DemoOnlyError() }
  async createChild(s: Session, _input: NewChildInput): Promise<{ studentId: string }> { this.need(s, 'parent'); throw new DemoOnlyError('בהדגמה לא יוצרים חשבונות ילדים.') }
  async enrollThisDevice(s: Session, _studentId: string): Promise<void> { this.need(s, 'parent'); throw new DemoOnlyError('בהדגמה כל המכשירים "מאושרים".') }

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
    return this.remember(await this.wait(this.session(u)), 'signed_in')!
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
    return this.remember(await this.wait(this.session(st)), 'signed_in')!
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
    return this.remember(await this.wait(this.session(st)), 'signed_in')!
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
  async myMaterials(s: Session) { this.need(s, 'teacher', 'parent'); return this.wait(this.materials.filter(m => m.ownerId === s.userId)) }

  // ---------- materials ----------
  private ownMaterial(s: Session, id: string): Material {
    this.need(s, 'teacher', 'parent')
    const m = this.materials.find(x => x.id === id)
    if (!m || m.ownerId !== s.userId) throw new ForbiddenError('החומר לא נמצא או שאינו שלך')
    return m
  }
  private canRead(s: Session, m: Material) {
    if (m.ownerId === s.userId || s.role === 'admin') return true
    return this.shares.some(sh => sh.materialId === m.id && (
      (sh.groupId && (this.group(sh.groupId).studentIds.includes(s.userId) || this.teaches(s, this.group(sh.groupId))
        || (s.role === 'parent' && this.childrenOf(s.userId).some(c => this.group(sh.groupId!).studentIds.includes(c.studentId)))))
      || (sh.studentId && (sh.studentId === s.userId || (s.role === 'parent' && this.childrenOf(s.userId).some(c => c.studentId === sh.studentId))))))
  }
  async uploadMaterial(s: Session, file: File, title: string) {
    this.need(s, 'teacher', 'parent')
    if (!(file.type in ACCEPTED)) throw new Error('אפשר להעלות רק PDF או תמונה (JPEG, PNG, WebP)')
    if (file.size <= 0 || file.size > MAX_BYTES) throw new Error('הקובץ גדול מדי (עד 20MB)')
    const m: Material = { id: 'm-' + Math.random().toString(36).slice(2, 8), ownerId: s.userId, title: title.trim() || file.name, fileName: file.name,
      pages: 0, status: 'uploaded', uploadedAt: new Date().toISOString().slice(0, 10), mimeType: file.type, sizeBytes: file.size,
      extractionStatus: file.type === 'application/pdf' ? 'pending' : 'unsupported' }
    this.materials.push(m)
    try { this.files.set(m.id, URL.createObjectURL(file)) } catch { /* no object URLs in tests */ }
    return this.wait(m)
  }
  async materialDetail(s: Session, id: string) {
    const m = this.materials.find(x => x.id === id)
    if (!m || !this.canRead(s, m)) throw new ForbiddenError('החומר לא נמצא או שאין לך גישה אליו')
    const owner = m.ownerId === s.userId
    return this.wait({ material: m, owner, text: owner ? this.texts.get(id) ?? null : null, topics: owner ? this.topics.get(id) ?? [] : [],
      drafts: owner ? this.drafts.filter(d => d.materialId === id) : [], shares: this.shares.filter(x => x.materialId === id).map(({ groupId, studentId }) => ({ groupId, studentId })) })
  }
  async materialFileUrl(s: Session, id: string) {
    const m = this.materials.find(x => x.id === id)
    if (!m || !this.canRead(s, m)) throw new ForbiddenError('אין גישה לקובץ')
    const url = this.files.get(id)
    if (!url) throw new Error('בהדגמה אפשר לפתוח רק קבצים שהועלו עכשיו')
    return this.wait(url)
  }
  async saveExtraction(s: Session, id: string, text: string, pages: number) {
    const m = this.ownMaterial(s, id)
    this.texts.set(id, text.slice(0, 200000)); m.pages = pages; m.extractionStatus = text.trim() ? 'done' : 'failed'
    await this.wait(null)
  }
  async saveTopics(s: Session, id: string, topics: MaterialTopic[]) {
    this.ownMaterial(s, id)
    this.topics.set(id, topics.filter(t => t.title.trim()).slice(0, 200).map(t => ({ title: t.title.trim().slice(0, 200), body: t.body.slice(0, 20000) })))
    await this.wait(null)
  }
  async createTemplateDraft(s: Session, id: string, meta: { subjectName: string; grade: string }) {
    const m = this.ownMaterial(s, id)
    const topics = this.topics.get(id) ?? []
    if (!topics.length) throw new Error('קודם יוצרים נושאים')
    const pack = templatePack(topics, { ...meta, unit: m.title })
    if (checkPack(pack).length) throw new Error('בחומר הזה אין מספיק משפטים לבניית שאלות')
    const d: ContentDraft = { id: 'cd-' + Math.random().toString(36).slice(2, 8), materialId: id, provider: 'template', status: 'draft', pack, createdAt: new Date().toISOString() }
    this.drafts.push(d)
    return this.wait(d)
  }
  async requestAiDraft(s: Session, id: string): Promise<ContentDraft> {
    this.ownMaterial(s, id)
    throw new DemoOnlyError('בהדגמה אין יצירה עם בינה מלאכותית. אפשר להשתמש בתבנית האוטומטית.')
  }
  async reviewDraft(s: Session, draftId: string, approve: boolean) {
    const d = this.drafts.find(x => x.id === draftId)
    if (!d) throw new ForbiddenError('הטיוטה לא נמצאה')
    this.ownMaterial(s, d.materialId)
    if (d.status !== 'draft') throw new Error('הטיוטה כבר נבדקה')
    d.status = approve ? 'approved' : 'rejected'
    await this.wait(null)
  }
  async quizFromDraft(s: Session, draftId: string, groupId: string, title: string) {
    this.need(s, 'teacher')
    const d = this.drafts.find(x => x.id === draftId)
    if (!d) throw new ForbiddenError('הטיוטה לא נמצאה')
    this.ownMaterial(s, d.materialId)
    if (d.status !== 'approved') throw new Error('קודם מאשרים את התוכן')
    const pools = Object.values((d.pack.pools ?? {}) as Record<string, { items: { text: string; options: string[]; answer: string }[] }>)
    const items = pools.flatMap(p => p.items).filter(it => Array.isArray(it.options) && it.options.includes(it.answer)).slice(0, 20)
      .map((it, i) => ({ position: i + 1, prompt: it.text, options: it.options, answerIndex: it.options.indexOf(it.answer) }))
    if (!items.length) throw new Error('בתוכן אין שאלות אמריקאיות')
    return (await this.createAssignment(s, { groupId, title, instructions: '', kind: 'quiz', items })).id
  }
  async shareMaterial(s: Session, id: string, target: MaterialShare) {
    this.ownMaterial(s, id)
    if (!!target.groupId === !!target.studentId) throw new Error('משתפים עם קבוצה אחת או עם ילד אחד')
    if (target.groupId && !(s.role === 'teacher' && this.teaches(s, this.group(target.groupId)))) throw new ForbiddenError('הקבוצה הזאת לא שלך')
    if (target.studentId && !(s.role === 'parent' && this.childrenOf(s.userId).some(c => c.studentId === target.studentId))) throw new ForbiddenError('אפשר לשתף רק עם ילד שלך')
    if (!this.shares.some(x => x.materialId === id && x.groupId === target.groupId && x.studentId === target.studentId)) this.shares.push({ materialId: id, ...target })
    await this.wait(null)
  }
  async sharedWithMe(s: Session) { return this.wait(this.materials.filter(m => m.ownerId !== s.userId && this.canRead(s, m))) }
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
        assignments: this.assignments.filter(a => a.status === 'published' && groups.some(g => g.id === a.groupId))
          .map(a => ({ ...this.forViewer(a, false), progress: this.progress.find(p => p.assignmentId === a.id && p.studentId === student.id) })),
        consents: this.consents.filter(c => c.studentId === student.id),
        sessions: this.sessions.filter(x => x.studentId === student.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20),
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
    return this.wait(this.assignments.filter(a => a.status === 'published' && groups.some(g => g.id === a.groupId)).map(a => ({
      ...this.forViewer(a, false), group: groups.find(g => g.id === a.groupId)!,
      progress: this.progress.find(p => p.assignmentId === a.id && p.studentId === s.userId),
    })))
  }
  async myProgress(s: Session) { this.need(s, 'student'); return this.wait(this.subjects.filter(x => x.studentId === s.userId)) }

  // ---------- assignments (teacher) ----------
  /** students and parents never receive answer keys */
  private forViewer(a: Assignment, withKeys: boolean): Assignment {
    return { ...a, items: a.items?.map(it => (withKeys ? { ...it } : { position: it.position, prompt: it.prompt, options: [...it.options] })) }
  }
  private ownAssignment(s: Session, id: string) {
    const a = this.assignments.find(x => x.id === id)
    if (!a || !this.teaches(s, this.group(a.groupId))) throw new ForbiddenError('המשימה הזאת לא שלך')
    return a
  }
  private checkInput(input: AssignmentInput) {
    if (!input.title.trim()) throw new Error('צריך כותרת למשימה')
    if (input.kind === 'practice' && !input.playPath) throw new Error('צריך לבחור במה מתרגלים')
  }
  async createAssignment(s: Session, input: AssignmentInput) {
    this.need(s, 'teacher')
    if (!this.teaches(s, this.group(input.groupId))) throw new ForbiddenError('הקבוצה הזאת לא שלך')
    this.checkInput(input)
    const a: Assignment = { id: 'as-' + Math.random().toString(36).slice(2, 8), groupId: input.groupId, title: input.title.trim(), kind: input.kind,
      status: 'draft', dueAt: input.dueAt ?? '', instructions: input.instructions, playPath: input.kind === 'practice' ? input.playPath : undefined,
      items: input.kind === 'quiz' ? (input.items ?? []).map((it, i) => ({ ...it, position: i + 1 })) : undefined }
    this.assignments.push(a)
    return this.wait(a)
  }
  async updateAssignment(s: Session, id: string, input: AssignmentInput) {
    this.need(s, 'teacher')
    const a = this.ownAssignment(s, id)
    if (a.status !== 'draft') throw new Error('אפשר לערוך רק טיוטה. משימה שפורסמה נשארת כמו שהיא')
    this.checkInput(input)
    Object.assign(a, { title: input.title.trim(), instructions: input.instructions, kind: input.kind, dueAt: input.dueAt ?? '',
      playPath: input.kind === 'practice' ? input.playPath : undefined,
      items: input.kind === 'quiz' ? (input.items ?? []).map((it, i) => ({ ...it, position: i + 1 })) : undefined })
    return this.wait(a)
  }
  async publishAssignment(s: Session, id: string) {
    this.need(s, 'teacher')
    const a = this.ownAssignment(s, id)
    if (a.status !== 'draft') throw new Error('אפשר לפרסם רק טיוטה')
    if (a.kind === 'quiz' && (!a.items?.length || a.items.some(it => it.answerIndex === undefined || it.answerIndex >= it.options.length))) {
      throw new Error('לכל שאלה במבחן צריך תשובה נכונה')
    }
    a.status = 'published'
    await this.wait(null)
  }
  async archiveAssignment(s: Session, id: string) { this.need(s, 'teacher'); this.ownAssignment(s, id).status = 'archived'; await this.wait(null) }
  async assignmentDetail(s: Session, id: string) {
    const a = this.assignments.find(x => x.id === id)
    if (!a) throw new ForbiddenError('המשימה לא נמצאה')
    const g = this.group(a.groupId)
    const teacher = s.role === 'teacher' && this.teaches(s, g)
    const visible = teacher || s.role === 'admin' || (a.status === 'published' && (
      (s.role === 'student' && g.studentIds.includes(s.userId)) || (s.role === 'parent' && this.childrenOf(s.userId).some(c => g.studentIds.includes(c.studentId)))))
    if (!visible) throw new ForbiddenError('המשימה לא נמצאה או שאין לך גישה אליה')
    return this.wait({ ...this.forViewer(a, teacher), group: g })
  }

  // ---------- learning (student) – practice is unverified; the quiz is graded here, like on the server ----------
  private studentAssignment(s: Session, id: string | null) {
    this.need(s, 'student')
    if (id === null) return null
    const a = this.assignments.find(x => x.id === id)
    if (!a || a.status !== 'published' || !this.group(a.groupId).studentIds.includes(s.userId)) throw new ForbiddenError('המשימה לא זמינה')
    return a
  }
  private statusOf(studentId: string, assignmentId: string) {
    let p = this.progress.find(x => x.studentId === studentId && x.assignmentId === assignmentId)
    if (!p) { p = { studentId, assignmentId, state: 'in_progress', practiceQuestions: 0, practiceFirstTry: 0, attempts: 0 }; this.progress.push(p) }
    return p
  }
  async startSession(s: Session, assignmentId: string | null) {
    const a = this.studentAssignment(s, assignmentId)
    const sess: LearningSession = { id: 'ls-' + Math.random().toString(36).slice(2, 10), studentId: s.userId, assignmentId: a?.id, startedAt: new Date().toISOString(), questions: 0, firstTry: 0 }
    this.sessions.push(sess)
    if (a) this.statusOf(s.userId, a.id)
    return this.wait(sess.id)
  }
  async recordProgress(s: Session, sessionId: string, events: PracticeEvent[]) {
    this.need(s, 'student')
    const sess = this.sessions.find(x => x.id === sessionId && x.studentId === s.userId)
    if (!sess) throw new ForbiddenError('השיעור לא נמצא')
    if (events.length < 1 || events.length > 50) throw new Error('send 1–50 events')
    if (sess.assignmentId) this.studentAssignment(s, sess.assignmentId)
    let n = 0
    for (const e of events) {
      if (this.eventIds.has(e.id)) continue
      this.eventIds.add(e.id); n++
      if (e.kind === 'question') { sess.questions++; if (e.ok) sess.firstTry++ }
      if (sess.assignmentId) {
        const p = this.statusOf(s.userId, sess.assignmentId)
        if (e.kind === 'question') { p.practiceQuestions = (p.practiceQuestions ?? 0) + 1; if (e.ok) p.practiceFirstTry = (p.practiceFirstTry ?? 0) + 1 }
        if (e.kind === 'round_done' && p.state !== 'completed') p.state = 'practiced'
        p.lastActivityAt = new Date().toISOString()
      }
    }
    return this.wait(n)
  }
  async finishSession(s: Session, sessionId: string) {
    this.need(s, 'student')
    const sess = this.sessions.find(x => x.id === sessionId && x.studentId === s.userId)
    if (!sess) throw new ForbiddenError('השיעור לא נמצא')
    sess.endedAt ??= new Date().toISOString()
    await this.wait(null)
  }
  async submitQuiz(s: Session, assignmentId: string, answers: number[]): Promise<QuizResult> {
    const a = this.studentAssignment(s, assignmentId)!
    if (a.kind !== 'quiz' || !a.items) throw new Error('זה לא מבחן')
    if (answers.length !== a.items.length) throw new Error('צריך לענות על כל השאלות')
    const key = `${assignmentId}:${s.userId}`
    const tries = this.attempts.get(key) ?? 0
    if (tries >= 3) throw new Error('נגמרו הניסיונות')
    this.attempts.set(key, tries + 1)
    const score = a.items.filter((it, i) => answers[i] === it.answerIndex).length
    const p = this.statusOf(s.userId, assignmentId)
    Object.assign(p, { state: 'completed', verifiedScore: Math.max(p.verifiedScore ?? 0, score), verifiedMax: a.items.length, attempts: (p.attempts ?? 0) + 1 })
    return this.wait({ score, max: a.items.length, attempt: tries + 1, attemptsLeft: 2 - tries, late: !!a.dueAt && a.dueAt < new Date().toISOString().slice(0, 10) })
  }
}
