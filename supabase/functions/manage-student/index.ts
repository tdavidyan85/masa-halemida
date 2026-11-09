// Edge Function `manage-student` (Deno): a verified parent creates a child account or sets a new PIN/password.
//   POST { action:'create', fullName, birthDate, grade, relation, loginMode, pin | username+password }
//   POST { action:'set_secret', studentId, kind:'pin'|'password', secret }
// The caller must send their own session (Authorization: Bearer <access token>); verify_jwt stays ON.
// NOT deployed and NOT yet run against a real Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createStudent, setStudentSecret } from '../_shared/manageStudent.ts'
import { corsHeaders, errorResponse, json } from '../_shared/http.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const ALLOWED = Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173'

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

const deps = {
  isVerifiedParent: (id: string) => rpc<boolean>('srv_is_verified_parent', { p_user: id }),
  db: {
    findDuplicate: (p: string, n: string, d: string) => rpc<string | null>('srv_find_duplicate_child', { p_parent: p, p_full_name: n, p_birth_date: d }),
    usernameTaken: (u: string) => rpc<boolean>('srv_username_taken', { p_username: u }),
    register: (a: { parentId: string; studentId: string; fullName: string; birthDate: string; grade: string; loginMode: string; username: string | null; secretHash: string; relation: string }) =>
      rpc<void>('srv_register_student', { p_parent: a.parentId, p_student: a.studentId, p_full_name: a.fullName, p_birth_date: a.birthDate,
        p_grade: a.grade, p_login_mode: a.loginMode, p_username: a.username, p_secret_hash: a.secretHash, p_relation: a.relation }),
    setSecret: (p: string, s: string, h: string) => rpc<void>('srv_set_secret', { p_parent: p, p_student: s, p_secret_hash: h }),
  },
  auth: {
    async createUser(email: string, password: string, fullName: string) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
      if (error || !data.user) throw new Error('createUser failed')
      return data.user.id
    },
    async deleteUser(id: string) { await admin.auth.admin.deleteUser(id) },
  },
}

Deno.serve(async req => {
  const headers = corsHeaders(req.headers.get('origin'), ALLOWED)
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return json(405, { error: 'method' }, headers)
  try {
    // who is calling – answered by Supabase Auth from the caller's own access token
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: u, error } = await admin.auth.getUser(jwt)
    if (error || !u.user) return json(401, { error: 'auth', message: 'צריך להתחבר מחדש' }, headers)
    const body = await req.json().catch(() => ({}))
    if (body.action === 'create') return json(201, await createStudent(u.user.id, body, deps), headers)
    if (body.action === 'set_secret') { await setStudentSecret(u.user.id, body, deps); return json(200, { ok: true }, headers) }
    return json(400, { error: 'action', message: 'פעולה לא מוכרת' }, headers)
  } catch (e) {
    return errorResponse(e, headers)
  }
})
