// Student sign-in flow (no Deno or network code here, so it can be tested with fakes and a local database).
//   pin:      { mode:'pin', studentId, pin, deviceToken }  – only from a device a parent approved for that child
//   password: { mode:'password', username, password }
//   profiles: { mode:'profiles', deviceTokens:[…] }        – the picture grid of an approved device
// The session is NOT made here: on success we ask Supabase Auth for one (deps.auth.sessionFor).
import { DUMMY_HASH, sha256Hex, verifySecret } from './secrets.ts'
import { InputError, checkUuid } from './validate.ts'

export interface LoginDb {
  lookup(mode: 'pin' | 'password', username: string | null, studentId: string | null, deviceHash: string | null):
    Promise<{ student_id: string; secret_hash: string; email: string } | null>
  gate(studentId: string | null, ipHash: string | null): Promise<{ allowed: boolean; reason?: string; until?: string }>
  record(studentId: string | null, ipHash: string | null, ok: boolean, deviceHash: string | null):
    Promise<{ ok: boolean; remaining?: number; locked_until?: string | null; hard_locked?: boolean }>
  deviceProfiles(deviceHashes: string[]): Promise<{ student_id: string; first_name: string; avatar_path: string | null }[]>
  /** ties the new session to the device it was opened on, so revoking the device ends it (fails → no session) */
  bindSession(sessionId: string, studentId: string, deviceHash: string | null): Promise<void>
}
export interface LoginAuth {
  /** a normal Supabase Auth session for this (student) user – made by Supabase Auth, not by us */
  sessionFor(email: string): Promise<{ access_token: string; refresh_token: string; expires_in: number; session_id: string }>
}
export interface LoginDeps { db: LoginDb; auth: LoginAuth; verify?: typeof verifySecret }

export type LoginResult =
  | { status: 200; body: { session: { access_token: string; refresh_token: string; expires_in: number } } }
  | { status: 200; body: { profiles: { id: string; firstName: string; avatarPath: string | null }[] } }
  | { status: 401; body: { error: 'wrong'; message: string; remaining?: number } }
  | { status: 423; body: { error: 'locked' | 'needs_parent'; message: string; until?: string | null } }
  | { status: 429; body: { error: 'too_many'; message: string } }

const MSG = {
  wrong: 'הפרטים לא נכונים. נסו שוב',
  locked: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה',
  needs_parent: 'החשבון נעול. צריך שהורה ישחרר אותו',
  too_many: 'יותר מדי ניסיונות מהמכשיר הזה. נסו שוב מאוחר יותר',
}

function blocked(reason: string | undefined, until?: string | null): LoginResult {
  if (reason === 'too_many_from_address') return { status: 429, body: { error: 'too_many', message: MSG.too_many } }
  if (reason === 'needs_parent') return { status: 423, body: { error: 'needs_parent', message: MSG.needs_parent } }
  return { status: 423, body: { error: 'locked', message: MSG.locked, until: until ?? null } }
}

export async function studentLogin(input: unknown, ipHash: string | null, deps: LoginDeps): Promise<LoginResult> {
  const verify = deps.verify ?? verifySecret
  const req = (input ?? {}) as Record<string, unknown>

  if (req.mode === 'profiles') {
    const tokens = Array.isArray(req.deviceTokens) ? req.deviceTokens.filter((t): t is string => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)).slice(0, 12) : []
    const hashes = await Promise.all(tokens.map(sha256Hex))
    const rows = hashes.length ? await deps.db.deviceProfiles(hashes) : []
    return { status: 200, body: { profiles: rows.map(r => ({ id: r.student_id, firstName: r.first_name, avatarPath: r.avatar_path })) } }
  }

  let mode: 'pin' | 'password', username: string | null = null, studentId: string | null = null, deviceHash: string | null = null, secret: string
  if (req.mode === 'pin') {
    mode = 'pin'
    studentId = checkUuid(req.studentId, 'תלמיד')
    if (typeof req.pin !== 'string' || !/^\d{6}$/.test(req.pin)) throw new InputError('הקוד צריך להיות 6 ספרות')
    if (typeof req.deviceToken !== 'string' || !/^[0-9a-f]{64}$/.test(req.deviceToken)) throw new InputError('המכשיר הזה לא אושר לכניסה בקוד')
    secret = req.pin
    deviceHash = await sha256Hex(req.deviceToken)
  } else if (req.mode === 'password') {
    mode = 'password'
    if (typeof req.username !== 'string' || typeof req.password !== 'string' || !req.username || !req.password) throw new InputError('צריך שם משתמש וסיסמה')
    username = req.username.trim().toLowerCase().slice(0, 64)
    secret = req.password.slice(0, 256)
  } else {
    throw new InputError('בקשה לא מוכרת')
  }

  // 1. too many attempts from this address?
  const ipGate = await deps.db.gate(null, ipHash)
  if (!ipGate.allowed) return blocked(ipGate.reason)

  // 2. find the account; a miss costs the same time as a wrong secret and gives the same answer
  const acct = await deps.db.lookup(mode, username, studentId, deviceHash)
  if (!acct) {
    await verify(secret, DUMMY_HASH)
    await deps.db.record(null, ipHash, false, null)
    return { status: 401, body: { error: 'wrong', message: MSG.wrong } }
  }

  // 3. account locked?
  const gate = await deps.db.gate(acct.student_id, ipHash)
  if (!gate.allowed) return blocked(gate.reason, gate.until)

  // 4. check the secret and record the result atomically (the database counts and locks)
  const ok = await verify(secret, acct.secret_hash)
  const rec = await deps.db.record(acct.student_id, ipHash, ok, deviceHash)
  if (!ok) {
    if (rec.hard_locked) return blocked('needs_parent')
    if (rec.locked_until) return blocked('locked', rec.locked_until)
    return { status: 401, body: { error: 'wrong', message: MSG.wrong, remaining: rec.remaining } }
  }

  // 5. only now: a normal session from Supabase Auth
  const { session_id, ...session } = await deps.auth.sessionFor(acct.email)
  await deps.db.bindSession(session_id, acct.student_id, deviceHash)   // throws → the client gets no tokens
  return { status: 200, body: { session } }
}
