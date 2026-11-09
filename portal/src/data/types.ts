// Domain types. They mirror the planned Supabase tables (profiles, user_roles, students, guardianships,
// groups, group_teachers, group_members, invitations, consents, assignments, progress) so that a real
// data source can replace the mock one without touching the screens.

export type Role = 'admin' | 'teacher' | 'parent' | 'student'

export interface Person {
  id: string
  role: Role
  fullName: string
  /** an illustrated sample picture (data: URL) – never a real photo in this demo */
  avatar: string
  status: 'active' | 'pending' | 'suspended'
}

export interface Adult extends Person {
  role: 'admin' | 'teacher' | 'parent'
  email: string
}

export type LoginMode = 'pin' | 'password'

export interface Student extends Person {
  role: 'student'
  grade: Grade
  loginMode: LoginMode
  /** only for loginMode 'password' */
  username?: string
}

export type Grade = 'גן' | 'א' | 'ב' | 'ג' | 'ד' | 'ה' | 'ו'
export const GRADES: Grade[] = ['גן', 'א', 'ב', 'ג', 'ד', 'ה', 'ו']

export type SubjectId = 'math' | 'english' | 'hebrew' | 'science'
export const SUBJECTS: Record<SubjectId, { name: string; emoji: string; color: string }> = {
  math: { name: 'חשבון', emoji: '🔢', color: 'var(--c-sky)' },
  english: { name: 'אנגלית', emoji: '🔤', color: 'var(--c-pink)' },
  hebrew: { name: 'עברית', emoji: '📖', color: 'var(--c-yellow)' },
  science: { name: 'מדעים', emoji: '🔬', color: 'var(--c-green)' },
}

export interface Group {
  id: string
  name: string
  subject: SubjectId
  grade: Grade
  teacherIds: string[]
  /** students whose parent approved the membership */
  studentIds: string[]
  archived?: boolean
}

export interface Guardianship {
  parentId: string
  studentId: string
  relation: 'אמא' | 'אבא' | 'אפוטרופוס/ית'
  verified: boolean
}

export type InvitationStatus = 'pending' | 'approved' | 'declined' | 'expired'
export interface Invitation {
  id: string
  groupId: string
  invitedBy: string
  parentId: string
  /** the child the teacher had in mind; the parent decides which child (or a new one) */
  childHint: string
  status: InvitationStatus
  sentAt: string
}

export type AssignmentKind = 'practice' | 'exam' | 'reading'
export interface Assignment {
  id: string
  groupId: string
  title: string
  kind: AssignmentKind
  dueAt: string
  materialId?: string
  /** a link into the existing learning engine (opened as is, the engine is not changed) */
  playPath?: string
  /** short text the student can have read aloud */
  instructions: string
}

export interface Material {
  id: string
  ownerId: string
  title: string
  fileName: string
  pages: number
  status: 'uploaded' | 'processing' | 'ready_for_review' | 'approved'
  uploadedAt: string
}

export type ProgressState = 'not_started' | 'in_progress' | 'done'
export interface AssignmentProgress {
  studentId: string
  assignmentId: string
  state: ProgressState
  /** 0..100, only for finished practice / exams */
  score?: number
}

export interface SubjectProgress {
  studentId: string
  subject: SubjectId
  /** share right on the first try, 0..100 */
  firstTry: number
  questions: number
  daysActive: number
  strong: string[]
  needsWork: string[]
}

export interface Consent {
  id: string
  studentId: string
  parentId: string
  scope: 'group' | 'ai_material' | 'photo'
  groupId?: string
  grantedAt: string
  revokedAt?: string
}

export interface Session {
  userId: string
  role: Role
  fullName: string
  avatar: string
}
