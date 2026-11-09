// Real data source on Supabase (supabase-js v2). Built from a validated config only (see config.ts).
// NOT yet run against a real Supabase project – verified so far with a fake client in unit tests, and
// the database rules it relies on are verified separately (supabase/tests). Treat as development code.
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
import type { ChildOverview, DataSource, GroupDetail, NewChildInput, PinProfile, SessionEvent, SignUpInput, StudentTask } from './source'
import type { Adult, Assignment, Consent, Grade, Group, Invitation, Material, Role, Session, Student, SubjectId, SubjectProgress } from './types'
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
      assignments: [], progress: [],          // assignments are not in the database yet
    }
  }
  async myStudents(s: Session) {
    const groups = (await this.myGroups(s)).filter(g => !g.archived)
    const students = await this.listStudents()
    return students.filter(x => groups.some(g => g.studentIds.includes(x.id))).map(x => ({ ...x, groups: groups.filter(g => g.studentIds.includes(x.id)) }))
  }
  async myAssignments(): Promise<(Assignment & { group: Group })[]> { return [] }   // not in the database yet
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
    return links.map(l => {
      const id = String(l.student_id)
      return {
        student: this.student(id, students.find(x => x.id === id), people.get(id)),
        relation: l.relation as ChildOverview['relation'],
        groups: groups.filter(g => g.studentIds.includes(id) && !g.archived),
        subjects: [] as SubjectProgress[], assignments: [],            // progress is not in the database yet
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
  async myTasks(): Promise<StudentTask[]> { return [] }
  async myProgress(): Promise<SubjectProgress[]> { return [] }
}

/** the only way the app creates a server source: from a validated config (config.ts) */
export function createSupabaseSource(cfg: ServerConfig, redirectTo = `${location.origin}${location.pathname}`): DataSource {
  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'masa-portal-auth' },
  })
  return new SupabaseSource(sb, redirectTo)
}
