// A verified parent creates a child's account, or sets a new PIN/password.
// The caller is identified by Supabase Auth (their JWT) before this runs; every rule is re-checked by the
// database function (srv_register_student / srv_set_secret), so this file cannot widen anyone's rights.
import { DEFAULT_ITERATIONS, hashSecret, randomSecret } from './secrets.ts'
import { GRADES, InputError, RELATIONS, checkBirthDate, checkName, checkPassword, checkPin, checkUsername, checkUuid, oneOf } from './validate.ts'

export class ConflictError extends Error { status = 409; constructor(m: string) { super(m); this.name = 'ConflictError' } }
export class ForbiddenError extends Error { status = 403; constructor(m: string) { super(m); this.name = 'ForbiddenError' } }

export interface ManageDb {
  findDuplicate(parentId: string, fullName: string, birthDate: string): Promise<string | null>
  register(a: { parentId: string; studentId: string; fullName: string; birthDate: string; grade: string;
    loginMode: 'pin' | 'password'; username: string | null; secretHash: string; relation: string }): Promise<void>
  setSecret(parentId: string, studentId: string, secretHash: string): Promise<void>
  usernameTaken(username: string): Promise<boolean>
}
export interface ManageAuth {
  /** Supabase Auth admin: a user with an undeliverable address and a random password nobody keeps */
  createUser(email: string, password: string, fullName: string): Promise<string>
  deleteUser(id: string): Promise<void>
}
export interface ManageDeps { db: ManageDb; auth: ManageAuth; iterations?: number; isVerifiedParent(parentId: string): Promise<boolean> }

/** students get an address that can never receive mail (.invalid is reserved) and reveals nothing */
export const studentEmail = (): string => `s-${crypto.randomUUID()}@students.masa-halemida.invalid`

export async function createStudent(parentId: string, input: unknown, deps: ManageDeps): Promise<{ studentId: string }> {
  const r = (input ?? {}) as Record<string, unknown>
  const fullName = checkName(r.fullName)
  const birthDate = checkBirthDate(r.birthDate)
  const grade = oneOf(r.grade, GRADES, 'כיתה לא תקינה')
  const relation = oneOf(r.relation, RELATIONS, 'צריך לבחור קרבה')
  const loginMode = oneOf(r.loginMode, ['pin', 'password'] as const, 'צריך לבחור דרך כניסה')
  const username = loginMode === 'password' ? checkUsername(r.username) : null
  const secret = loginMode === 'pin' ? checkPin(r.pin) : checkPassword(r.password)

  // fail early (and without creating anything) – the database checks all of this again
  if (!(await deps.isVerifiedParent(parentId))) throw new ForbiddenError('רק הורה שאימת דוא״ל וטלפון יכול ליצור חשבון לילד')
  if (await deps.db.findDuplicate(parentId, fullName, birthDate)) throw new ConflictError('כבר יש לך ילד עם אותו שם ותאריך לידה')
  if (username && await deps.db.usernameTaken(username)) throw new ConflictError('שם המשתמש הזה תפוס')

  const secretHash = await hashSecret(secret, deps.iterations ?? DEFAULT_ITERATIONS)
  const studentId = await deps.auth.createUser(studentEmail(), randomSecret(32), fullName)
  try {
    await deps.db.register({ parentId, studentId, fullName, birthDate, grade, loginMode, username, secretHash, relation })
  } catch (e) {
    await deps.auth.deleteUser(studentId).catch(() => {})   // never leave a half-made account behind
    const msg = String((e as { message?: string })?.message ?? e)
    if (/already has an account|duplicate key/.test(msg)) throw new ConflictError('כבר יש לך ילד עם אותו שם ותאריך לידה, או ששם המשתמש תפוס')
    if (/verified parent/.test(msg)) throw new ForbiddenError('רק הורה מאומת יכול ליצור חשבון לילד')
    throw e
  }
  return { studentId }
}

export async function setStudentSecret(parentId: string, input: unknown, deps: ManageDeps): Promise<void> {
  const r = (input ?? {}) as Record<string, unknown>
  const studentId = checkUuid(r.studentId, 'תלמיד')
  const kind = oneOf(r.kind, ['pin', 'password'] as const, 'מה מחליפים?')
  const secret = kind === 'pin' ? checkPin(r.secret) : checkPassword(r.secret)
  try {
    await deps.db.setSecret(parentId, studentId, await hashSecret(secret, deps.iterations ?? DEFAULT_ITERATIONS))
  } catch (e) {
    if (/verified parent/.test(String((e as Error).message))) throw new ForbiddenError('רק הורה מאומת של הילד יכול להחליף את הקוד')
    throw e
  }
}

export { InputError }
