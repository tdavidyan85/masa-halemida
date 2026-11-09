// FICTIONAL sample data for the local demo. These people do not exist; any resemblance is a coincidence.
// Nothing here is real, nothing is sent anywhere, and the PINs/passwords below exist only for the demo.
import { sampleAvatar } from './avatar'
import type {
  Adult, Assignment, AssignmentProgress, Consent, Group, Guardianship, Invitation, LearningSession, Material, Student, SubjectProgress,
} from './types'

const a = (id: string, role: Adult['role'], fullName: string, email: string, long = false, status: Adult['status'] = 'active'): Adult =>
  ({ id, role, fullName, email, status, avatar: sampleAvatar(id, { long }) })
const s = (id: string, fullName: string, grade: Student['grade'], loginMode: Student['loginMode'], long: boolean, username?: string): Student =>
  ({ id, role: 'student', fullName, grade, loginMode, username, status: 'active', avatar: sampleAvatar(id, { long, child: true }) })

export const ADULTS: Adult[] = [
  a('u-admin', 'admin', 'אורית שמעוני', 'admin@demo.local', true),
  a('u-t1', 'teacher', 'מיכל ברק', 'michal@demo.local', true),
  a('u-t2', 'teacher', 'דנה אלון', 'dana@demo.local', true),
  a('u-t3', 'teacher', 'יעל רוזן', 'yael@demo.local', true, 'pending'),
  a('u-p1', 'parent', 'רונית לוי', 'ronit@demo.local', true),
  a('u-p2', 'parent', 'אבי לוי', 'avi@demo.local'),
  a('u-p3', 'parent', 'סיגל מזרחי', 'sigal@demo.local', true),
  a('u-p4', 'parent', 'עומר חדד', 'omer@demo.local'),
  a('u-p5', 'parent', 'מאיה כץ', 'maya@demo.local', true),
]

export const STUDENTS: Student[] = [
  s('s-noam', 'נועם לוי', 'ב', 'pin', false),
  s('s-tamar', 'תמר לוי', 'ה', 'password', true, 'tamar.levi'),
  s('s-itay', 'איתי מזרחי', 'גן', 'pin', false),
  s('s-shira', 'שירה מזרחי', 'ו', 'password', true, 'shira.m'),
  s('s-ella', 'אלה חדד', 'א', 'pin', true),
  s('s-yonatan', 'יונתן חדד', 'ד', 'password', false, 'yonatan.h'),
  s('s-lior', 'ליאור כץ', 'ה', 'password', false, 'lior.katz'),
]

/** demo-only secrets (a real system keeps only salted hashes on the server) */
export const DEMO_PASSWORD = 'demo1234'
export const DEMO_PIN = '123456'

export const GUARDIANSHIPS: Guardianship[] = [
  { parentId: 'u-p1', studentId: 's-noam', relation: 'אמא', verified: true },
  { parentId: 'u-p1', studentId: 's-tamar', relation: 'אמא', verified: true },
  { parentId: 'u-p2', studentId: 's-noam', relation: 'אבא', verified: true },
  { parentId: 'u-p2', studentId: 's-tamar', relation: 'אבא', verified: true },
  { parentId: 'u-p3', studentId: 's-itay', relation: 'אמא', verified: true },
  { parentId: 'u-p3', studentId: 's-shira', relation: 'אמא', verified: true },
  { parentId: 'u-p4', studentId: 's-ella', relation: 'אבא', verified: true },
  { parentId: 'u-p4', studentId: 's-yonatan', relation: 'אבא', verified: false },
  { parentId: 'u-p5', studentId: 's-lior', relation: 'אמא', verified: true },
]

export const GROUPS: Group[] = [
  { id: 'g-math5', name: 'חשבון ה׳ – קבוצת תגבור', subject: 'math', grade: 'ה', teacherIds: ['u-t1'], studentIds: ['s-tamar', 's-lior'] },
  { id: 'g-math6', name: 'חשבון ו׳ – הכנה למבחן', subject: 'math', grade: 'ו', teacherIds: ['u-t1'], studentIds: ['s-shira'] },
  { id: 'g-eng', name: 'אנגלית ד׳–ו׳ – שמות גוף', subject: 'english', grade: 'ה', teacherIds: ['u-t2', 'u-t1'], studentIds: ['s-tamar', 's-yonatan', 's-shira'] },
  { id: 'g-read', name: 'קריאה ראשונה א׳–ב׳', subject: 'hebrew', grade: 'א', teacherIds: ['u-t2'], studentIds: ['s-noam', 's-ella'] },
  { id: 'g-old', name: 'קיץ תשפ״ו (ארכיון)', subject: 'math', grade: 'ד', teacherIds: ['u-t1'], studentIds: [], archived: true },
]

export const INVITATIONS: Invitation[] = [
  { id: 'inv-1', groupId: 'g-math5', invitedBy: 'u-t1', parentId: 'u-p1', childHint: 'נועם', status: 'pending', sentAt: '2026-11-07' },
  { id: 'inv-2', groupId: 'g-read', invitedBy: 'u-t2', parentId: 'u-p3', childHint: 'איתי', status: 'pending', sentAt: '2026-11-08' },
  { id: 'inv-3', groupId: 'g-eng', invitedBy: 'u-t2', parentId: 'u-p5', childHint: 'ליאור', status: 'declined', sentAt: '2026-11-02' },
  { id: 'inv-4', groupId: 'g-math6', invitedBy: 'u-t1', parentId: 'u-p4', childHint: 'יונתן', status: 'expired', sentAt: '2026-10-20' },
]

export const CONSENTS: Consent[] = [
  { id: 'c-1', studentId: 's-tamar', parentId: 'u-p1', scope: 'group', groupId: 'g-math5', grantedAt: '2026-10-01' },
  { id: 'c-2', studentId: 's-tamar', parentId: 'u-p1', scope: 'group', groupId: 'g-eng', grantedAt: '2026-10-03' },
  { id: 'c-3', studentId: 's-noam', parentId: 'u-p1', scope: 'group', groupId: 'g-read', grantedAt: '2026-10-05' },
  { id: 'c-4', studentId: 's-tamar', parentId: 'u-p1', scope: 'photo', grantedAt: '2026-10-01' },
  { id: 'c-5', studentId: 's-shira', parentId: 'u-p3', scope: 'group', groupId: 'g-math6', grantedAt: '2026-09-28' },
  { id: 'c-6', studentId: 's-shira', parentId: 'u-p3', scope: 'group', groupId: 'g-eng', grantedAt: '2026-09-29' },
  { id: 'c-7', studentId: 's-ella', parentId: 'u-p4', scope: 'group', groupId: 'g-read', grantedAt: '2026-10-11' },
  { id: 'c-8', studentId: 's-yonatan', parentId: 'u-p4', scope: 'group', groupId: 'g-eng', grantedAt: '2026-10-12' },
  { id: 'c-9', studentId: 's-lior', parentId: 'u-p5', scope: 'group', groupId: 'g-math5', grantedAt: '2026-10-02' },
]

export const MATERIALS: Material[] = [
  { id: 'm-1', ownerId: 'u-t1', title: 'שברים – דף עבודה 3', fileName: 'shvarim-3.pdf', pages: 2, status: 'approved', uploadedAt: '2026-11-01' },
  { id: 'm-2', ownerId: 'u-t1', title: 'מבחן ראמ״ה לדוגמה', fileName: 'rama-sample.pdf', pages: 6, status: 'ready_for_review', uploadedAt: '2026-11-06' },
  { id: 'm-3', ownerId: 'u-t2', title: 'Pronouns – worksheet', fileName: 'pronouns.pdf', pages: 1, status: 'approved', uploadedAt: '2026-10-25' },
  { id: 'm-4', ownerId: 'u-t2', title: 'אותיות ותנועות – קמץ ופתח', fileName: 'kamatz.pdf', pages: 3, status: 'processing', uploadedAt: '2026-11-08' },
]

export const ASSIGNMENTS: Assignment[] = [
  { id: 'as-1', groupId: 'g-math5', title: 'שברים: חיבור וחיסור', kind: 'practice', status: 'published', dueAt: '2026-11-12', materialId: 'm-1', playPath: 'fractions/',
    instructions: 'תרגלו חיבור וחיסור של שברים עם אותו מכנה. אפשר לבקש רמז בכל שאלה.' },
  { id: 'as-2', groupId: 'g-math5', title: 'מבחן קצר: מספרים גדולים', kind: 'quiz', status: 'published', dueAt: '2026-11-15',
    instructions: 'שלוש שאלות, בלי שעון. אפשר ללחוץ על הרמקול כדי לשמוע כל שאלה.',
    items: [
      { position: 1, prompt: 'איזה מספר גדול יותר?', options: ['45,100', '45,010', '4,510'], answerIndex: 0 },
      { position: 2, prompt: 'כמה עשרות אלפים יש במספר 63,200?', options: ['3', '6', '2'], answerIndex: 1 },
      { position: 3, prompt: '10,000 + 2,000 + 30 =', options: ['12,300', '12,030', '1,230'], answerIndex: 1 },
    ] },
  { id: 'as-3', groupId: 'g-eng', title: 'Pronouns – he, she, it', kind: 'practice', status: 'published', dueAt: '2026-11-11', materialId: 'm-3', playPath: 'english/',
    instructions: 'בחרו את שם הגוף המתאים לכל משפט. כל מילה באנגלית אפשר לשמוע.' },
  { id: 'as-4', groupId: 'g-read', title: 'קריאה: קמץ ופתח', kind: 'reading', status: 'published', dueAt: '2026-11-13',
    instructions: 'הקשיבו למילים וחפשו את האות עם התנועה הנכונה.' },
  { id: 'as-5', groupId: 'g-math6', title: 'הכנה למבחן: סדר פעולות', kind: 'practice', status: 'published', dueAt: '2026-11-14', playPath: 'math/',
    instructions: 'פותרים לפי סדר הפעולות: קודם כפל וחילוק, אחר כך חיבור וחיסור.' },
  { id: 'as-6', groupId: 'g-math5', title: 'טיוטה: גאומטריה', kind: 'practice', status: 'draft', dueAt: '2026-11-20', playPath: 'math/',
    instructions: 'עוד לא פורסם לתלמידים.' },
]

export const ASSIGNMENT_PROGRESS: AssignmentProgress[] = [
  { studentId: 's-tamar', assignmentId: 'as-1', state: 'practiced', practiceQuestions: 24, practiceFirstTry: 20 },
  { studentId: 's-tamar', assignmentId: 'as-2', state: 'completed', verifiedScore: 2, verifiedMax: 3, attempts: 1 },
  { studentId: 's-tamar', assignmentId: 'as-3', state: 'practiced', practiceQuestions: 16, practiceFirstTry: 12 },
  { studentId: 's-lior', assignmentId: 'as-1', state: 'in_progress', practiceQuestions: 6, practiceFirstTry: 3 },
  { studentId: 's-yonatan', assignmentId: 'as-3', state: 'practiced', practiceQuestions: 10, practiceFirstTry: 6 },
  { studentId: 's-shira', assignmentId: 'as-5', state: 'practiced', practiceQuestions: 30, practiceFirstTry: 28 },
  { studentId: 's-noam', assignmentId: 'as-4', state: 'in_progress' },
  { studentId: 's-ella', assignmentId: 'as-4', state: 'practiced', practiceQuestions: 0, practiceFirstTry: 0 },
]

export const SESSIONS: LearningSession[] = [
  { id: 'ls-1', studentId: 's-tamar', assignmentId: 'as-1', startedAt: '2026-11-08T16:10:00Z', endedAt: '2026-11-08T16:25:00Z', questions: 24, firstTry: 20 },
  { id: 'ls-2', studentId: 's-tamar', assignmentId: 'as-3', startedAt: '2026-11-07T15:00:00Z', endedAt: '2026-11-07T15:12:00Z', questions: 16, firstTry: 12 },
  { id: 'ls-3', studentId: 's-tamar', startedAt: '2026-11-06T17:30:00Z', endedAt: '2026-11-06T17:40:00Z', questions: 9, firstTry: 7 },
  { id: 'ls-4', studentId: 's-noam', assignmentId: 'as-4', startedAt: '2026-11-08T14:00:00Z', questions: 0, firstTry: 0 },
]

export const SUBJECT_PROGRESS: SubjectProgress[] = [
  { studentId: 's-tamar', subject: 'math', firstTry: 78, questions: 214, daysActive: 9, strong: ['כפל במאונך', 'מספרים גדולים'], needsWork: ['שברים במספר מעורב'] },
  { studentId: 's-tamar', subject: 'english', firstTry: 66, questions: 120, daysActive: 6, strong: ['he / she'], needsWork: ['we / they'] },
  { studentId: 's-noam', subject: 'hebrew', firstTry: 71, questions: 64, daysActive: 5, strong: ['קמץ'], needsWork: ['פתח מול קמץ'] },
  { studentId: 's-shira', subject: 'math', firstTry: 88, questions: 302, daysActive: 14, strong: ['סדר פעולות', 'גאומטריה'], needsWork: [] },
  { studentId: 's-shira', subject: 'english', firstTry: 54, questions: 40, daysActive: 3, strong: [], needsWork: ['it / they'] },
  { studentId: 's-ella', subject: 'hebrew', firstTry: 82, questions: 51, daysActive: 7, strong: ['זיהוי אותיות'], needsWork: [] },
  { studentId: 's-yonatan', subject: 'english', firstTry: 61, questions: 77, daysActive: 4, strong: ['I / you'], needsWork: ['he / she'] },
  { studentId: 's-lior', subject: 'math', firstTry: 59, questions: 98, daysActive: 5, strong: ['חיבור שברים'], needsWork: ['השוואת שברים', 'בעיות מילוליות'] },
]
