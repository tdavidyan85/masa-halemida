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

export type AssignmentKind = 'practice' | 'quiz' | 'reading'
export type AssignmentStatus = 'draft' | 'published' | 'archived'
/** the existing learning engine is opened only at one of these paths (same list as the database) */
export const PLAYER_PATHS = { 'math/': 'חשבון', 'english/': 'אנגלית', 'fractions/': 'שברים' } as const
export type PlayerPath = keyof typeof PLAYER_PATHS

export interface QuizItem {
  id?: string
  position: number
  prompt: string
  options: string[]
  /** present only for the teacher – students never receive answer keys */
  answerIndex?: number
}

export interface Assignment {
  id: string
  groupId: string
  title: string
  kind: AssignmentKind
  status: AssignmentStatus
  dueAt: string
  materialId?: string
  /** practice: where the existing learning engine opens (allow-listed; the engine itself is not changed) */
  playPath?: PlayerPath
  /** short text the student can have read aloud */
  instructions: string
  items?: QuizItem[]
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

export type ProgressState = 'not_started' | 'in_progress' | 'practiced' | 'completed'
export interface AssignmentProgress {
  studentId: string
  assignmentId: string
  state: ProgressState
  /** UNVERIFIED practice telemetry reported by the student's browser */
  practiceQuestions?: number
  practiceFirstTry?: number
  /** VERIFIED: graded by the server against answer keys the student never sees */
  verifiedScore?: number
  verifiedMax?: number
  attempts?: number
  lastActivityAt?: string
}

export interface LearningSession {
  id: string
  studentId: string
  assignmentId?: string
  startedAt: string
  endedAt?: string
  questions: number
  firstTry: number
}

export interface PracticeEvent {
  /** client-made id: the server ignores a resent event (idempotent) */
  id: string
  kind: 'question' | 'round_done'
  skill?: string
  topic?: string
  ok?: boolean
  ms?: number
}

export interface QuizResult { score: number; max: number; attempt: number; attemptsLeft: number; late: boolean }

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
