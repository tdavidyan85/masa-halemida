// Edge Function `student-login` (Deno). Thin wrapper: all rules are in ../_shared/studentLogin.ts and in the database.
// NOT deployed and NOT yet run against a real Supabase. Must be verified on a local Supabase (`supabase start`)
// before any production use – in particular the generateLink + verifyOtp step below.
//
// Environment (set by Supabase for Edge Functions): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Ours: ALLOWED_ORIGINS (comma list), IP_HASH_SALT (any random string; makes stored address hashes useless elsewhere).
// config.toml sets verify_jwt = false for this function: a student has no session yet when signing in.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { studentLogin } from '../_shared/studentLogin.ts'
import { sha256Hex } from '../_shared/secrets.ts'
import { clientIp, corsHeaders, errorResponse, json } from '../_shared/http.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const ALLOWED = Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173'
const SALT = Deno.env.get('IP_HASH_SALT') ?? ''

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

const deps = {
  db: {
    lookup: async (mode: 'pin' | 'password', username: string | null, studentId: string | null, deviceHash: string | null) =>
      (await rpc<{ student_id: string; secret_hash: string; email: string }[]>('srv_login_lookup',
        { p_mode: mode, p_username: username, p_student: studentId, p_device_hash: deviceHash }))[0] ?? null,
    gate: (studentId: string | null, ipHash: string | null) => rpc<{ allowed: boolean; reason?: string; until?: string }>('srv_login_gate', { p_student: studentId, p_ip_hash: ipHash }),
    record: (studentId: string | null, ipHash: string | null, ok: boolean, deviceHash: string | null) =>
      rpc<{ ok: boolean; remaining?: number; locked_until?: string | null; hard_locked?: boolean }>('srv_login_record', { p_student: studentId, p_ip_hash: ipHash, p_ok: ok, p_device_hash: deviceHash }),
    deviceProfiles: (hashes: string[]) => rpc<{ student_id: string; first_name: string; avatar_path: string | null }[]>('srv_device_profiles', { p_device_hashes: hashes }),
  },
  auth: {
    // Supabase Auth makes the session: an admin magic-link token, exchanged at once on the server.
    // Nothing is e-mailed (the student address is .invalid) and no token is created by our code.
    async sessionFor(email: string) {
      const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      if (e1 || !link?.properties?.hashed_token) throw new Error('generateLink failed')
      const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
      if (e2 || !data.session) throw new Error('verifyOtp failed')
      return { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in }
    },
  },
}

Deno.serve(async req => {
  const headers = corsHeaders(req.headers.get('origin'), ALLOWED)
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return json(405, { error: 'method' }, headers)
  try {
    const ip = clientIp(req)
    const ipHash = ip ? await sha256Hex(SALT + ip) : null
    const r = await studentLogin(await req.json().catch(() => ({})), ipHash, deps)
    return json(r.status, r.body, headers)
  } catch (e) {
    return errorResponse(e, headers)
  }
})
