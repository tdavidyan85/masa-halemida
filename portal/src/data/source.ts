// The one seam between the screens and the data. Today: MockSource (local, fictional).
// Later: a Supabase implementation of the same interface, where every rule below is enforced by RLS and
// Edge Functions on the server. The screens never talk to a backend directly.
import type {
  Adult, Assignment, AssignmentProgress, Consent, Group, Guardianship, Invitation, Material, Session, Student, SubjectProgress,
} from './types'
import type { CheckResult } from '../auth/attemptLimiter'

export class ForbiddenError extends Error {
  constructor(message = 'אין הרשאה לפעולה הזאת') { super(message); this.name = 'ForbiddenError' }
}
export class LoginError extends Error {
  constructor(message: string, public readonly detail?: CheckResult) { super(message); this.name = 'LoginError' }
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
}

export interface StudentTask extends Assignment { group: Group; progress?: AssignmentProgress }

export interface DataSource {
  readonly kind: 'mock' | 'supabase'
  // sign-in
  signInAdult(email: string, password: string): Promise<Session>
  /** students who sign in with a picture + PIN on this (enrolled) device */
  pinProfiles(): Promise<PinProfile[]>
  signInPin(studentId: string, pin: string): Promise<Session>
  signInPassword(username: string, password: string): Promise<Session>
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
  myInvitations(s: Session): Promise<(Invitation & { group: Group })[]>
  createGroup(s: Session, input: Pick<Group, 'name' | 'subject' | 'grade'>): Promise<Group>
  inviteParent(s: Session, groupId: string, parentEmail: string, childHint: string): Promise<Invitation>
  // parent
  myChildren(s: Session): Promise<ChildOverview[]>
  parentInvitations(s: Session): Promise<(Invitation & { group: Group; teacher: Adult })[]>
  respondInvitation(s: Session, invitationId: string, approve: boolean, childId?: string): Promise<Invitation>
  releaseLock(s: Session, studentId: string): Promise<void>
  // student
  myTasks(s: Session): Promise<StudentTask[]>
  myProgress(s: Session): Promise<SubjectProgress[]>
}
