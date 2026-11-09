// Real data source on Supabase (supabase-js v2). Built from a validated config only (see config.ts).
// Verified against a real LOCAL Supabase (browser run: parent sign-in, child account, device approval, PIN
// sign-in) and with a fake client in unit tests. Not yet against a cloud project – development code.
//
// Rules this file follows:
//  * Sessions come from Supabase Auth only: adults via signInWithPassword / signUp; students via the
//    student-login Edge Function, whose answer is a normal Supabase session handed to auth.setSession().
//  * Every read names its columns (some columns are closed to the API on purpose; select('*') would fail).
//  * Every sensitive write goes through an RPC or Edge Function that re-checks the caller on the server.
//  * Errors reaching the screen are plain Hebrew; server internals are not shown.
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { sampleAvatar } from './avatar'
import { ForbiddenError, LoginError, ServerError } from './source'
import type { AssignmentInput, ChildOverview, DataSource, GroupDetail, NewChildInput, PinProfile, SessionEvent, SignUpInput, StudentTask } from './source'
import type { Adult, Assignment, AssignmentProgress, Consent, Grade, Group, Invitation, LearningSession, Material, PracticeEvent, QuizItem, QuizResult, Role, Session, Student, SubjectId, SubjectProgress } from './types'
import type { DataConfig } from './config'

type ServerConfig = Extract<DataConfig, { mode: 'server' }>
const ROLE_ORDER: Role[] = ['admin', 'teacher', 'parent', 'student']
const DEVICE_KEY = 'masa-device-tokens'              // { studentId: deviceToken } – this device's PIN approvals

interface PgError { code?: string; message?: string }
/** turn any server error into something a user can read */
export function toUserError(e: unknown): Error {
  if (e instanceof LoginError || e instanceof ForbiddenError || e instanceof ServerError) return e
  const err = (e ?? {}) as PgError & { name?: string }
  if (err.code === '42501' || /permission denied|row-level security/i.test(err.message ?? '')) return new ForbiddenError()
  if (err.name === 'TypeError' || /fetch|network/i.test(err.message ?? '')) return new ServerError('אין חיבור לשרת. בדקו את האינטרנט ונסו שוב')
  return new ServerError()
}
function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw toUserError(r.error)
  return r.data as T
}

function readDeviceTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as Record<string, string> } catch { return {} }
}
function saveDeviceToken(studentId: string, token: string) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...readDeviceTokens(), [studentId]: token })) } catch { /* storage off */ }
}

type Row = Record<string, unknown>
const ASSIGNMENT_COLS = 'id, group_id, title, instructions, kind, player_path, status, due_at'
const STATUS_COLS = 'assignment_id, student_id, state, practice_questions, practice_first_try, verified_score, verified_max, attempts, last_activity_at'
/** readable names for the engine's topic codes (unknown codes are shown as they are) */
const TOPIC_NAMES: Record<string, string> = { num: 'מספרים גדולים', ops: 'כפל וסדר פעולות', prime: 'גורמים ראשוניים', frac: 'שברים',
  word: 'בעיות מילוליות', geo: 'גאומטריה', dec: 'מספרים עשרוניים', pro: 'שמות גוף', repl: 'השלמת משפטים', write: 'כתיבה' }
const toAssignment = (r: Row): Assignment => ({ id: String(r.id), groupId: String(r.group_id), title: String(r.title), instructions: String(r.instructions ?? ''),
  kind: r.kind as Assignment['kind'], status: r.status as Assignment['status'], dueAt: (r.due_at as string | null) ?? '', playPath: (r.player_path as Assignment['playPath']) ?? undefined })
const toProgress = (r: Row): AssignmentProgress => ({ studentId: String(r.student_id), assignmentId: String(r.assignment_id), state: r.state as AssignmentProgress['state'],
  practiceQuestions: Number(r.practice_questions ?? 0), practiceFirstTry: Number(r.practice_first_try ?? 0),
  verifiedScore: r.verified_score == null ? undefined : Number(r.verified_score), verifiedMax: r.verified_max == null ? undefined : Number(r.verified_max),
  attempts: Number(r.attempts ?? 0), lastActivityAt: (r.last_activity_at as string | null) ?? undefined })

/** practice telemetry → per-subject summary (UNVERIFIED practice, shown as such) */
function summarize(studentId: string, events: Row[], subjectOfAssignment: (id: string | null) => SubjectId | null): SubjectProgress[] {
  const by = new Map<SubjectId, { q: number; f: number; days: Set<string>; topics: Map<string, [number, number]> }>()
  for (const e of events) {
    if (e.kind !== 'question') continue
    const subj = subjectOfAssignment((e.assignment_id as string | null) ?? null)
    if (!subj) continue
    const x = by.get(subj) ?? { q: 0, f: 0, days: new Set(), topics: new Map() }
    x.q++; if (e.correct_first) x.f++
    x.days.add(String(e.at).slice(0, 10))
    const t = String(e.topic ?? ''); if (t) { const c = x.topics.get(t) ?? [0, 0]; c[0]++; if (e.correct_first) c[1]++; x.topics.set(t, c) }
    by.set(subj, x)
  }
  return [...by].map(([subject, x]) => {
    const tp = [...x.topics].filter(([, c]) => c[0] >= 3)
    return { studentId, subject, questions: x.q, firstTry: x.q ? Math.round((x.f / x.q) * 100) : 0, daysActive: x.days.size,
      strong: tp.filter(([, c]) => c[1] / c[0] >= 0.8).map(([t]) => TOPIC_NAMES[t] ?? t),
      needsWork: tp.filter(([, c]) => c[1] / c[0] < 0.6).map(([t]) => TOPIC_NAMES[t] ?? t) }
  })
}
const subjectOf = (s: unknown): SubjectId => (['math', 'english', 'hebrew', 'science'].includes(String(s)) ? s as SubjectId : 'math')

export class SupabaseSource implements DataSource {
  readonly kind = 'supabase' as const
  constructor(private sb: SupabaseClient, private redirectTo: string) {}

  // ================= session =================
  /** the portal's view of a signed-in Supabase user: profile + the strongest ACTIVE role */
  private async toSession(user: User): Promise<Session> {
    const profile = check(await this.sb.from('profiles').select('id, full_name, avatar_path, status').eq('id', user.id).maybeSingle()) as Row | null
    if (!profile) throw new ServerError('הפרופיל לא נמצא')
    if (profile.status === 'suspended') { await this.sb.auth.signOut(); throw new LoginError('החשבון מושעה. פנו למנהל המערכת') }
    let roles = check(await this.sb.from('user_roles').select('role, status').eq('user_id', user.id)) as Row[]
    // first sign-in after confirming the e-mail: ask for the role chosen at sign-up (the server decides)
    const wanted = (user.user_metadata as { requested_role?: string } | undefined)?.requested_role
    if (!roles.length && (wanted === 'parent' || wanted === 'teacher')) {
      check(await this.sb.rpc('request_role', { p_role: wanted }))
      roles = check(await this.sb.from('user_roles').select('role, status').eq('user_id', user.id)) as Row[]
    }
    const role = ROLE_ORDER.find(r => roles.some(x => x.role === r && x.status === 'active'))
    if (!role) {
      await this.sb.auth.signOut()
      throw new LoginError(roles.some(x => x.status === 'pending') ? 'החשבון ממתין לאישור מנהל המערכת' : 'לחשבון הזה אין עדיין הרשאה. פנו למנהל המערכת')
    }
    return { userId: user.id, role, fullName: String(profile.full_name), avatar: await this.avatarUrl(user.id, profile.avatar_path as string | null) }
  }

  /** private bucket: a short-lived signed URL, or a drawn placeholder */
  private async avatarUrl(id: string, path: string | null): Promise<string> {
    if (path) {
      const { data } = await this.sb.storage.from('avatars').createSignedUrl(path, 3600)
      if (data?.signedUrl) return data.signedUrl
    }
    return sampleAvatar(id, { child: true })
  }

  async currentSession(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession()
    if (!data.session) return null
    try { return await this.toSession(data.session.user) } catch { return null }
  }

  onSessionChange(cb: (s: Session | null, e: SessionEvent) => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) { cb(null, 'signed_out'); return }
      if (event === 'PASSWORD_RECOVERY') { this.toSession(session.user).then(s => cb(s, 'password_recovery'), () => cb(null, 'password_recovery')); return }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // defer: supabase-js advises not to call other Supabase methods inside this callback
        setTimeout(() => { this.toSession(session.user).then(s => cb(s, event === 'SIGNED_IN' ? 'signed_in' : 'updated'), () => cb(null, 'signed_out')) }, 0)
      }
    })
    return () => data.subscription.unsubscribe()
  }

  async signOut() { await this.sb.auth.signOut() }

  // ================= adults =================
  async signInAdult(email: string, password: string): Promise<Session> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      if (/not confirmed/i.test(error.message)) throw new LoginError('צריך קודם לאשר את כתובת הדוא״ל (בדקו את תיבת הדואר)')
      if (/invalid login credentials/i.test(error.message)) throw new LoginError('הדוא״ל או הסיסמה לא נכונים')
      throw toUserError(error)
    }
    const s = await this.toSession(data.user)
    if (s.role === 'student') { await this.sb.auth.signOut(); throw new LoginError('תלמידים נכנסים מהמסך של התלמידים') }
    return s
  }

  async signUpAdult(input: SignUpInput) {
    if (input.password.length < 8) throw new LoginError('הסיסמה צריכה לפחות 8 תווים')
    const { data, error } = await this.sb.auth.signUp({
      email: input.email.trim(), password: input.password,
      // the role here is only a REQUEST: the server grants parent at once and keeps teacher pending for an admin
      options: { emailRedirectTo: this.redirectTo, data: { full_name: input.fullName.trim(), requested_role: input.role } },
    })
    if (error) {
      if (/password/i.test(error.message)) throw new LoginError('הסיסמה חלשה מדי. בחרו סיסמה ארוכה יותר')
      throw toUserError(error)
    }
    return { needsEmailConfirmation: !data.session }
  }

  async requestPasswordReset(email: string) {
    // same answer whether the address exists or not (no account discovery); only real failures surface
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: this.redirectTo })
    if (error && /fetch|network/i.test(error.message)) throw toUserError(error)
  }

  async updatePassword(newPassword: string) {
    if (newPassword.length < 8) throw new LoginError('הסיסמה צריכה לפחות 8 תווים')
    const { error } = await this.sb.auth.updateUser({ password: newPassword })
    if (error) throw toUserError(error)
  }

  // ================= students =================
  private async callLogin(body: Row): Promise<Row> {
    const { data, error } = await this.sb.functions.invoke('student-login', { body })
    if (error) {
      const res = (error as { context?: Response }).context
      const j = res && typeof res.json === 'function' ? await res.json().catch(() => null) as Row | null : null
      if (j?.message) {
        const remaining = typeof j.remaining === 'number' ? j.remaining : undefined
        throw new LoginError(String(j.message), remaining !== undefined ? { ok: true, remaining }
          : j.error === 'needs_parent' ? { ok: false, reason: 'needs_parent' } : j.error === 'locked' ? { ok: false, reason: 'locked', until: Date.parse(String(j.until)) || 0 } : undefined)
      }
      throw toUserError(error)
    }
    return data as Row
  }
  private async adopt(body: Row): Promise<Session> {
    const sess = body.session as { access_token: string; refresh_token: string } | undefined
    if (!sess) throw new ServerError()
    const { data, error } = await this.sb.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token })
    if (error || !data.user) throw toUserError(error)
    return this.toSession(data.user)
  }

  async pinProfiles(): Promise<PinProfile[]> {
    const tokens = Object.values(readDeviceTokens())
    if (!tokens.length) return []
    const body = await this.callLogin({ mode: 'profiles', deviceTokens: tokens })
    return ((body.profiles ?? []) as { id: string; firstName: string }[]).map(p => ({ id: p.id, firstName: p.firstName, avatar: sampleAvatar(p.id, { child: true }) }))
  }
  async signInPin(studentId: string, pin: string) {
    const deviceToken = readDeviceTokens()[studentId]
    if (!deviceToken) throw new LoginError('המכשיר הזה לא אושר לכניסה בקוד. בקשו מההורה לאשר אותו')
    return this.adopt(await this.callLogin({ mode: 'pin', studentId, pin, deviceToken }))
  }
  async signInPassword(username: string, password: string) {
    return this.adopt(await this.callLogin({ mode: 'password', username, password }))
  }

  // ================= parent: child accounts and devices =================
  async createChild(_s: Session, input: NewChildInput) {
    const { data, error } = await this.sb.functions.invoke('manage-student', { body: { action: 'create', ...input } })
    if (error) {
      const res = (error as { context?: Response }).context
      const j = res && typeof res.json === 'function' ? await res.json().catch(() => null) as Row | null : null
      if (j?.message) throw (res && res.status === 403 ? new ForbiddenError(String(j.message)) : new LoginError(String(j.message)))
      throw toUserError(error)
    }
    return data as { studentId: string }
  }
  async enrollThisDevice(_s: Session, studentId: string) {
    const token = check(await this.sb.rpc('enroll_device', { p_student: studentId, p_label: navigator.userAgent.slice(0, 40) })) as string
    saveDeviceToken(studentId, token)
  }
  async releaseLock(_s: Session, studentId: string) { check(await this.sb.rpc('release_student_lock', { p_student: studentId })) }

  // ================= shared readers =================
  private async profilesById(ids: string[]): Promise<Map<string, Row>> {
    if (!ids.length) return new Map()
    const rows = check(await this.sb.from('profiles').select('id, full_name, avatar_path, status').in('id', [...new Set(ids)])) as Row[]
    return new Map(rows.map(r => [String(r.id), r]))
  }
  private async groupsWithPeople(groupRows: Row[]): Promise<Group[]> {
    const ids = groupRows.map(g => String(g.id))
    if (!ids.length) return []
    const [teachers, members] = await Promise.all([
      this.sb.from('group_teachers').select('group_id, teacher_id').in('group_id', ids).then(check) as Promise<Row[]>,
      this.sb.from('group_members').select('group_id, student_id, status').in('group_id', ids).then(check) as Promise<Row[]>,
    ])
    return groupRows.map(g => ({
      id: String(g.id), name: String(g.name), subject: subjectOf(g.subject), grade: g.grade as Grade,
      teacherIds: teachers.filter(t => t.group_id === g.id).map(t => String(t.teacher_id)),
      studentIds: members.filter(m => m.group_id === g.id && m.status === 'active').map(m => String(m.student_id)),
      archived: !!g.archived_at,
    }))
  }
  private async visibleGroups(): Promise<Group[]> {
    return this.groupsWithPeople(check(await this.sb.from('groups').select('id, name, subject, grade, archived_at').order('created_at')) as Row[])
  }
  private student(id: string, s: Row | undefined, p: Row | undefined): Student {
    return { id, role: 'student', fullName: String(p?.full_name ?? ''), grade: (s?.grade ?? 'א') as Grade,
      loginMode: (s?.login_mode ?? 'pin') as Student['loginMode'], status: 'active', avatar: sampleAvatar(id, { child: true }) }
  }

  // ================= admin =================
  async listAdults(): Promise<Adult[]> {
    const [profiles, roles] = await Promise.all([
      this.sb.from('profiles').select('id, full_name, avatar_path, status').then(check) as Promise<Row[]>,
      this.sb.from('user_roles').select('user_id, role, status').then(check) as Promise<Row[]>,
    ])
    return profiles.flatMap(p => {
      const mine = roles.filter(r => r.user_id === p.id && r.status !== 'revoked')
      const role = (['admin', 'teacher', 'parent'] as const).find(r => mine.some(x => x.role === r))
      if (!role) return []
      const pending = mine.some(x => x.role === role && x.status === 'pending')
      return [{ id: String(p.id), role, fullName: String(p.full_name), email: '', avatar: sampleAvatar(String(p.id)),
        status: p.status === 'suspended' ? 'suspended' : pending ? 'pending' : 'active' } satisfies Adult]
    })
  }
  async listStudents(): Promise<Student[]> {
    const rows = check(await this.sb.from('students').select('id, grade, login_mode')) as Row[]
    const people = await this.profilesById(rows.map(r => String(r.id)))
    return rows.map(r => this.student(String(r.id), r, people.get(String(r.id))))
  }
  async listGroups(): Promise<Group[]> { return this.visibleGroups() }
  async setAdultStatus(_s: Session, id: string, status: Adult['status']): Promise<Adult> {
    if (status === 'suspended') check(await this.sb.rpc('admin_set_profile_status', { p_user: id, p_status: 'suspended' }))
    else {
      check(await this.sb.rpc('admin_set_profile_status', { p_user: id, p_status: 'active' }))
      const roles = check(await this.sb.from('user_roles').select('role, status').eq('user_id', id)) as Row[]
      if (roles.some(r => r.role === 'teacher' && r.status === 'pending')) check(await this.sb.rpc('admin_set_role', { p_user: id, p_role: 'teacher', p_status: 'active' }))
    }
    const a = (await this.listAdults()).find(x => x.id === id)
    if (!a) throw new ServerError('המשתמש לא נמצא')
    return a
  }

  // ================= teacher =================
  async myGroups(s: Session): Promise<Group[]> { return (await this.visibleGroups()).filter(g => g.teacherIds.includes(s.userId)) }
  async groupDetail(_s: Session, groupId: string): Promise<GroupDetail> {
    const g = check(await this.sb.from('groups').select('id, name, subject, grade, archived_at').eq('id', groupId).maybeSingle()) as Row | null
    if (!g) throw new ForbiddenError('הקבוצה לא נמצאה או שאין לך גישה אליה')
    const [group] = await this.groupsWithPeople([g])
    const studentRows = group.studentIds.length ? check(await this.sb.from('students').select('id, grade, login_mode').in('id', group.studentIds)) as Row[] : []
    const people = await this.profilesById([...group.teacherIds, ...group.studentIds])
    return {
      group,
      teachers: group.teacherIds.map(id => ({ id, role: 'teacher', fullName: String(people.get(id)?.full_name ?? ''), email: '', status: 'active', avatar: sampleAvatar(id) } as Adult)),
      students: studentRows.map(r => this.student(String(r.id), r, people.get(String(r.id)))),
      ...(await this.assignmentsWithStatus([group.id])),
    }
  }
  async myStudents(s: Session) {
    const groups = (await this.myGroups(s)).filter(g => !g.archived)
    const students = await this.listStudents()
    return students.filter(x => groups.some(g => g.studentIds.includes(x.id))).map(x => ({ ...x, groups: groups.filter(g => g.studentIds.includes(x.id)) }))
  }
  /** assignments of the given groups (RLS: teachers see drafts; students/parents only published) + visible statuses */
  private async assignmentsWithStatus(groupIds: string[]): Promise<{ assignments: Assignment[]; progress: AssignmentProgress[] }> {
    if (!groupIds.length) return { assignments: [], progress: [] }
    const rows = check(await this.sb.from('assignments').select(ASSIGNMENT_COLS).in('group_id', groupIds).order('created_at')) as Row[]
    const ids = rows.map(r => String(r.id))
    const st = ids.length ? check(await this.sb.from('assignment_status').select(STATUS_COLS).in('assignment_id', ids)) as Row[] : []
    return { assignments: rows.map(toAssignment), progress: st.map(toProgress) }
  }
  async myAssignments(s: Session): Promise<(Assignment & { group: Group })[]> {
    const groups = await this.myGroups(s)
    const { assignments } = await this.assignmentsWithStatus(groups.map(g => g.id))
    return assignments.map(a => ({ ...a, group: groups.find(g => g.id === a.groupId)! }))
  }
  async myMaterials(s: Session): Promise<Material[]> {
    const rows = check(await this.sb.from('learning_materials').select('id, title, storage_path, status, created_at').eq('owner_id', s.userId)) as Row[]
    return rows.map(r => ({ id: String(r.id), ownerId: s.userId, title: String(r.title), fileName: String(r.storage_path ?? '').split('/').pop() ?? '',
      pages: 0, status: r.status as Material['status'], uploadedAt: String(r.created_at).slice(0, 10) }))
  }
  async myInvitations(s: Session) {
    const rows = check(await this.sb.from('invitations').select('id, group_id, invited_by, child_hint, status, created_at').eq('invited_by', s.userId)) as Row[]
    const groups = await this.visibleGroups()
    return rows.flatMap(r => {
      const group = groups.find(g => g.id === r.group_id)
      return group ? [{ ...this.invitation(r), group }] : []
    })
  }
  private invitation(r: Row): Invitation {
    return { id: String(r.id), groupId: String(r.group_id), invitedBy: String(r.invited_by), parentId: '', childHint: String(r.child_hint ?? ''),
      status: (r.status === 'accepted' ? 'approved' : r.status === 'cancelled' ? 'declined' : r.status) as Invitation['status'], sentAt: String(r.created_at).slice(0, 10) }
  }
  async createGroup(_s: Session, input: Pick<Group, 'name' | 'subject' | 'grade'>): Promise<Group> {
    const row = check(await this.sb.from('groups').insert({ name: input.name.trim(), subject: input.subject, grade: input.grade })
      .select('id, name, subject, grade, archived_at').single()) as Row
    return (await this.groupsWithPeople([row]))[0]
  }
  async inviteParent(s: Session, groupId: string, parentEmail: string, childHint: string): Promise<Invitation> {
    const id = check(await this.sb.rpc('create_invitation', { p_group: groupId, p_parent_email: parentEmail.trim(), p_child_hint: childHint })) as string
    return { id, groupId, invitedBy: s.userId, parentId: '', childHint, status: 'pending', sentAt: new Date().toISOString().slice(0, 10) }
  }

  // ================= parent =================
  async myChildren(s: Session): Promise<ChildOverview[]> {
    const links = check(await this.sb.from('guardianships').select('student_id, relation, status').eq('parent_id', s.userId).eq('status', 'active')) as Row[]
    const ids = links.map(l => String(l.student_id))
    if (!ids.length) return []
    const [students, people, groups, consents] = await Promise.all([
      this.sb.from('students').select('id, grade, login_mode').in('id', ids).then(check) as Promise<Row[]>,
      this.profilesById(ids),
      this.visibleGroups(),
      this.sb.from('consents').select('id, student_id, guardian_id, scope, group_id, granted_at, revoked_at').in('student_id', ids).then(check) as Promise<Row[]>,
    ])
    const work = await this.assignmentsWithStatus(groups.map(g => g.id))
    const subjectOf = (aid: string | null): SubjectId | null => { const a = work.assignments.find(x => x.id === aid); return a ? groups.find(g => g.id === a.groupId)?.subject ?? null : null }
    const events = check(await this.sb.from('progress_events').select('student_id, session_id, assignment_id, kind, correct_first, topic, at').in('student_id', ids).order('at', { ascending: false }).limit(3000)) as Row[]
    const sessRows = check(await this.sb.from('learning_sessions').select('id, student_id, assignment_id, started_at, ended_at').in('student_id', ids).order('started_at', { ascending: false }).limit(60)) as Row[]
    const sessions: LearningSession[] = sessRows.map(r => {
      const ev = events.filter(e => e.session_id === r.id && e.kind === 'question')
      return { id: String(r.id), studentId: String(r.student_id), assignmentId: (r.assignment_id as string | null) ?? undefined, startedAt: String(r.started_at),
        endedAt: (r.ended_at as string | null) ?? undefined, questions: ev.length, firstTry: ev.filter(e => e.correct_first).length }
    })
    return links.map(l => {
      const id = String(l.student_id)
      return {
        student: this.student(id, students.find(x => x.id === id), people.get(id)),
        relation: l.relation as ChildOverview['relation'],
        groups: groups.filter(g => g.studentIds.includes(id) && !g.archived),
        subjects: summarize(id, events.filter(e => e.student_id === id), aid => subjectOf(aid)),
        assignments: work.assignments.filter(a => a.status === 'published' && groups.some(g => g.id === a.groupId && g.studentIds.includes(id)))
          .map(a => ({ ...a, progress: work.progress.find(p => p.assignmentId === a.id && p.studentId === id) })),
        sessions: sessions.filter(x => x.studentId === id),
        consents: consents.filter(c => c.student_id === id).map(c => ({ id: String(c.id), studentId: id, parentId: String(c.guardian_id),
          scope: c.scope as Consent['scope'], groupId: (c.group_id as string | null) ?? undefined, grantedAt: String(c.granted_at).slice(0, 10),
          revokedAt: c.revoked_at ? String(c.revoked_at).slice(0, 10) : undefined })),
      }
    })
  }
  async parentInvitations() {
    // RLS shows a parent only invitations sent to their confirmed address, and the groups they are invited to
    const rows = check(await this.sb.from('invitations').select('id, group_id, invited_by, child_hint, status, created_at')) as Row[]
    const groups = await this.visibleGroups()
    const people = await this.profilesById(rows.map(r => String(r.invited_by)))
    return rows.flatMap(r => {
      const group = groups.find(g => g.id === r.group_id)
      const t = people.get(String(r.invited_by))
      if (!group) return []
      const teacher: Adult = { id: String(r.invited_by), role: 'teacher', fullName: String(t?.full_name ?? 'מורה'), email: '', status: 'active', avatar: sampleAvatar(String(r.invited_by)) }
      return [{ ...this.invitation(r), group, teacher }]
    })
  }
  async respondInvitation(_s: Session, invitationId: string, approve: boolean, childId?: string): Promise<Invitation> {
    check(await this.sb.rpc('respond_invitation', { p_invitation: invitationId, p_accept: approve, p_student: childId ?? null }))
    return { id: invitationId, groupId: '', invitedBy: '', parentId: '', childHint: '', status: approve ? 'approved' : 'declined', sentAt: '' }
  }

  // ================= student (assignments and progress are not in the database yet) =================
  async myTasks(s: Session): Promise<StudentTask[]> {
    const groups = (await this.visibleGroups()).filter(g => !g.archived)
    const { assignments, progress } = await this.assignmentsWithStatus(groups.map(g => g.id))
    return assignments.filter(a => a.status === 'published').map(a => ({ ...a, group: groups.find(g => g.id === a.groupId)!,
      progress: progress.find(p => p.assignmentId === a.id && p.studentId === s.userId) }))
  }
  async myProgress(s: Session): Promise<SubjectProgress[]> {
    const groups = await this.visibleGroups()
    const { assignments } = await this.assignmentsWithStatus(groups.map(g => g.id))
    const events = check(await this.sb.from('progress_events').select('assignment_id, kind, correct_first, topic, at').eq('student_id', s.userId).order('at', { ascending: false }).limit(3000)) as Row[]
    return summarize(s.userId, events, aid => { const a = assignments.find(x => x.id === aid); return a ? groups.find(g => g.id === a.groupId)?.subject ?? null : null })
  }
  async startSession(_s: Session, assignmentId: string | null) {
    return check(await this.sb.rpc('start_session', { p_assignment: assignmentId })) as string
  }
  async recordProgress(_s: Session, sessionId: string, events: PracticeEvent[]) {
    return check(await this.sb.rpc('record_progress', { p_session: sessionId, p_events: events })) as number
  }
  async finishSession(_s: Session, sessionId: string) { check(await this.sb.rpc('finish_session', { p_session: sessionId })) }
  async submitQuiz(_s: Session, assignmentId: string, answers: number[]): Promise<QuizResult> {
    const r = check(await this.sb.rpc('submit_quiz', { p_assignment: assignmentId, p_answers: answers })) as { score: number; max: number; attempt: number; attempts_left: number; late: boolean }
    return { score: r.score, max: r.max, attempt: r.attempt, attemptsLeft: r.attempts_left, late: r.late }
  }

  // ================= teacher: assignments =================
  private async writeItems(assignmentId: string, items: QuizItem[] | undefined) {
    if (!items?.length) return
    const rows = check(await this.sb.from('assignment_items').insert(items.map((it, i) => ({ assignment_id: assignmentId, position: i + 1, prompt: it.prompt, options: it.options })))
      .select('id, position')) as Row[]
    const keys = rows.map(r => ({ item_id: String(r.id), answer_index: items[Number(r.position) - 1].answerIndex }))
    check(await this.sb.from('assignment_answer_keys').insert(keys))
  }
  async createAssignment(_s: Session, input: AssignmentInput): Promise<Assignment> {
    const row = check(await this.sb.from('assignments').insert({ group_id: input.groupId, title: input.title.trim(), instructions: input.instructions, kind: input.kind,
      player_path: input.kind === 'practice' ? input.playPath : null, due_at: input.dueAt || null }).select(ASSIGNMENT_COLS).single()) as Row
    if (input.kind === 'quiz') await this.writeItems(String(row.id), input.items)
    return toAssignment(row)
  }
  async updateAssignment(_s: Session, id: string, input: AssignmentInput): Promise<Assignment> {
    const rows = check(await this.sb.from('assignments').update({ title: input.title.trim(), instructions: input.instructions, kind: input.kind,
      player_path: input.kind === 'practice' ? input.playPath : null, due_at: input.dueAt || null }).eq('id', id).select(ASSIGNMENT_COLS)) as Row[]
    if (!rows.length) throw new ForbiddenError('אפשר לערוך רק טיוטה שלך')
    check(await this.sb.from('assignment_items').delete().eq('assignment_id', id))
    if (input.kind === 'quiz') await this.writeItems(id, input.items)
    return toAssignment(rows[0])
  }
  async publishAssignment(_s: Session, id: string) { check(await this.sb.rpc('publish_assignment', { p_assignment: id })) }
  async archiveAssignment(_s: Session, id: string) { check(await this.sb.rpc('archive_assignment', { p_assignment: id })) }
  async assignmentDetail(s: Session, id: string) {
    const row = check(await this.sb.from('assignments').select(ASSIGNMENT_COLS).eq('id', id).maybeSingle()) as Row | null
    if (!row) throw new ForbiddenError('המשימה לא נמצאה או שאין לך גישה אליה')
    const a = toAssignment(row)
    const group = (await this.visibleGroups()).find(g => g.id === a.groupId)
    if (!group) throw new ForbiddenError('המשימה לא נמצאה או שאין לך גישה אליה')
    if (a.kind === 'quiz') {
      const items = check(await this.sb.from('assignment_items').select('id, position, prompt, options').eq('assignment_id', id).order('position')) as Row[]
      a.items = items.map(r => ({ id: String(r.id), position: Number(r.position), prompt: String(r.prompt), options: r.options as string[] }))
      // only a teacher ever asks for the answer keys (RLS would return nothing to anyone else anyway)
      if (s.role === 'teacher' && items.length) {
        const keys = check(await this.sb.from('assignment_answer_keys').select('item_id, answer_index').in('item_id', items.map(r => String(r.id)))) as Row[]
        a.items = a.items.map(it => ({ ...it, answerIndex: keys.find(k => k.item_id === it.id)?.answer_index as number | undefined }))
      }
    }
    return { ...a, group }
  }
}

/** the only way the app creates a server source: from a validated config (config.ts) */
export function createSupabaseSource(cfg: ServerConfig, redirectTo = `${location.origin}${location.pathname}`): DataSource {
  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'masa-portal-auth' },
  })
  return new SupabaseSource(sb, redirectTo)
}
