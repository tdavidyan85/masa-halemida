// The one seam between the screens and the data. Today: MockSource (local, fictional).
// Later: a Supabase implementation of the same interface, where every rule below is enforced by RLS and
// Edge Functions on the server. The screens never talk to a backend directly.
import type {
  Adult, Assignment, AssignmentProgress, Consent, ContentDraft, Group, Guardianship, Invitation, LearningSession, Material, MaterialDetail,
  MaterialShare, MaterialTopic, PracticeEvent, QuizItem, QuizResult,
  Session, Student, SubjectProgress,
} from './types'
import type { CheckResult } from '../auth/attemptLimiter'

export class ForbiddenError extends Error {
  constructor(message = 'אין הרשאה לפעולה הזאת') { super(message); this.name = 'ForbiddenError' }
}
export class LoginError extends Error {
  constructor(message: string, public readonly detail?: CheckResult) { super(message); this.name = 'LoginError' }
}

/** an action that exists only with a real server (sign-up, password reset, creating a child…) */
export class DemoOnlyError extends Error {
  constructor(message = 'הפעולה הזאת לא זמינה במצב הדגמה. היא תעבוד כשהפורטל יחובר לשרת.') { super(message); this.name = 'DemoOnlyError' }
}
/** anything else that went wrong on the server, in words a user can read */
export class ServerError extends Error {
  constructor(message = 'משהו השתבש בשרת. נסו שוב בעוד רגע') { super(message); this.name = 'ServerError' }
}

export type SessionEvent = 'signed_in' | 'signed_out' | 'password_recovery' | 'updated'

export interface SignUpInput { fullName: string; email: string; password: string; role: 'parent' | 'teacher' }

export interface NewChildInput {
  fullName: string
  birthDate: string                 // YYYY-MM-DD
  grade: import('./types').Grade
  relation: 'אמא' | 'אבא' | 'אפוטרופוס/ית'
  loginMode: 'pin' | 'password'
  pin?: string
  username?: string
  password?: string
}

export interface PinProfile { id: string; firstName: string; avatar: string }

export interface GroupDetail {
  group: Group
  teachers: Adult[]
  students: Student[]
  assignments: Assignment[]
  progress: AssignmentProgress[]
}

export interface ChildOverview {
  student: Student
  relation: Guardianship['relation']
  groups: Group[]
  subjects: SubjectProgress[]
  assignments: (Assignment & { progress?: AssignmentProgress })[]
  consents: Consent[]
  /** recent learning sessions (newest first) */
  sessions: LearningSession[]
}

export interface StudentTask extends Assignment { group: Group; progress?: AssignmentProgress }

export interface AssignmentInput {
  groupId: string
  title: string
  instructions: string
  kind: Assignment['kind']
  playPath?: Assignment['playPath']
  dueAt?: string
  /** quiz only: questions with the correct option (kept server-side, never sent to students) */
  items?: QuizItem[]
}

export interface DataSource {
  readonly kind: 'mock' | 'supabase'
  // sign-in
  signInAdult(email: string, password: string): Promise<Session>
  /** students who sign in with a picture + PIN on this (enrolled) device */
  pinProfiles(): Promise<PinProfile[]>
  signInPin(studentId: string, pin: string): Promise<Session>
  signInPassword(username: string, password: string): Promise<Session>
  // session lifecycle (demo: a fictional session in this tab; server: Supabase Auth)
  currentSession(): Promise<Session | null>
  onSessionChange(cb: (s: Session | null, event: SessionEvent) => void): () => void
  signOut(): Promise<void>
  // adult accounts (server only)
  signUpAdult(input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }>
  /** always resolves the same way, whether or not the address has an account */
  requestPasswordReset(email: string): Promise<void>
  updatePassword(newPassword: string): Promise<void>
  // parent: a child's account, and approving this device for the child's PIN sign-in (server only)
  createChild(s: Session, input: NewChildInput): Promise<{ studentId: string }>
  enrollThisDevice(s: Session, studentId: string): Promise<void>
  // admin
  listAdults(s: Session): Promise<Adult[]>
  listStudents(s: Session): Promise<Student[]>
  listGroups(s: Session): Promise<Group[]>
  setAdultStatus(s: Session, id: string, status: Adult['status']): Promise<Adult>
  // teacher
  myGroups(s: Session): Promise<Group[]>
  groupDetail(s: Session, groupId: string): Promise<GroupDetail>
  myStudents(s: Session): Promise<(Student & { groups: Group[] })[]>
  myAssignments(s: Session): Promise<(Assignment & { group: Group })[]>
  myMaterials(s: Session): Promise<Material[]>
  // learning materials (teachers and parents; students only read what was shared with them)
  uploadMaterial(s: Session, file: File, title: string): Promise<Material>
  materialDetail(s: Session, id: string): Promise<MaterialDetail>
  materialFileUrl(s: Session, id: string): Promise<string>
  saveExtraction(s: Session, id: string, text: string, pages: number, confidence?: number): Promise<void>
  saveTopics(s: Session, id: string, topics: MaterialTopic[]): Promise<void>
  /** a draft built by fixed rules (no AI) from the topics */
  createTemplateDraft(s: Session, id: string, meta: { subjectName: string; grade: string }): Promise<ContentDraft>
  /** an AI draft made on the server; fails with a clear message when no AI provider is configured */
  requestAiDraft(s: Session, id: string, meta: { subjectName: string; grade: string }): Promise<ContentDraft>
  /** edit questions/lessons of a draft before approving it (the template/AI label stays; it is marked as edited) */
  updateDraft(s: Session, draftId: string, pack: Record<string, unknown>): Promise<void>
  reviewDraft(s: Session, draftId: string, approve: boolean): Promise<void>
  /** an APPROVED draft's multiple-choice questions → a draft quiz assignment for one of the teacher's groups */
  quizFromDraft(s: Session, draftId: string, groupId: string, title: string, itemKeys?: string[]): Promise<string>
  shareMaterial(s: Session, id: string, target: MaterialShare): Promise<void>
  sharedWithMe(s: Session): Promise<Material[]>
  myInvitations(s: Session): Promise<(Invitation & { group: Group })[]>
  createGroup(s: Session, input: Pick<Group, 'name' | 'subject' | 'grade'>): Promise<Group>
  inviteParent(s: Session, groupId: string, parentEmail: string, childHint: string): Promise<Invitation>
  // teacher: assignments (drafts are editable; published work is frozen)
  createAssignment(s: Session, input: AssignmentInput): Promise<Assignment>
  updateAssignment(s: Session, id: string, input: AssignmentInput): Promise<Assignment>
  publishAssignment(s: Session, id: string): Promise<void>
  archiveAssignment(s: Session, id: string): Promise<void>
  /** with items; the answer keys only for the group's teacher */
  assignmentDetail(s: Session, id: string): Promise<Assignment & { group: Group }>
  // parent
  myChildren(s: Session): Promise<ChildOverview[]>
  parentInvitations(s: Session): Promise<(Invitation & { group: Group; teacher: Adult })[]>
  respondInvitation(s: Session, invitationId: string, approve: boolean, childId?: string): Promise<Invitation>
  releaseLock(s: Session, studentId: string): Promise<void>
  // student
  myTasks(s: Session): Promise<StudentTask[]>
  /** learning (student only): practice telemetry is UNVERIFIED; only submitQuiz yields a verified result */
  startSession(s: Session, assignmentId: string | null): Promise<string>
  recordProgress(s: Session, sessionId: string, events: PracticeEvent[]): Promise<number>
  finishSession(s: Session, sessionId: string): Promise<void>
  submitQuiz(s: Session, assignmentId: string, answers: number[]): Promise<QuizResult>
  myProgress(s: Session): Promise<SubjectProgress[]>
}
