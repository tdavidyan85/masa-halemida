// END-TO-END tests against a running LOCAL Supabase (real Auth, REST, Storage, Edge Runtime, Mailpit).
// Skipped (not "passed") unless E2E_API_URL etc. are set – see README. Only 127.0.0.1/localhost is accepted.
// Every user here is fictional, gets a unique address, and is deleted at the end. No e-mail or SMS leaves the
// machine: mail goes to the local Mailpit, and the phones are test numbers with a fixed code (config.toml).
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const E = {
  api: process.env.E2E_API_URL, anon: process.env.E2E_ANON_KEY, service: process.env.E2E_SERVICE_ROLE_KEY, mail: process.env.E2E_MAILPIT_URL,
}
const ready = Object.values(E).every(Boolean)
if (ready) for (const u of [E.api, E.mail]) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) throw new Error(`e2e tests run only against this machine, not ${u}`)
}
const RUN = Date.now().toString(36)
const REDIRECT = 'http://localhost:5173/'
const PHONE_OK = '972500000901', OTP = '246810'
const mail = n => `e2e-${RUN}-${n}@example.test`

/** a browser-like client: PKCE + its own in-memory storage (like the portal, one per "person") */
function person() {
  const mem = new Map()
  return createClient(E.api, E.anon, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    storage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) }, removeItem: k => { mem.delete(k) } } } })
}
const admin = () => createClient(E.api, E.service, { auth: { persistSession: false, autoRefreshToken: false } })

async function inbox(to, { wait = 8000 } = {}) {
  const end = Date.now() + wait
  while (Date.now() < end) {
    const r = await (await fetch(`${E.mail}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()
    if (r.messages?.length) return Promise.all(r.messages.map(async m => (await fetch(`${E.mail}/api/v1/message/${m.ID}`)).json()))
    await new Promise(r => setTimeout(r, 300))
  }
  return []
}
/** follow the e-mailed Supabase link like a browser would, and return the ?code= it redirects to */
async function codeFromMail(to) {
  const [m] = await inbox(to)
  assert.ok(m, `no e-mail for ${to}`)
  const link = (m.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S+/) ?? [])[0]
  assert.ok(link, 'no verification link in the e-mail')
  const res = await fetch(link.replace(/&amp;/g, '&'), { redirect: 'manual' })
  const loc = res.headers.get('location') ?? ''
  assert.ok(loc.startsWith(REDIRECT), `redirected to ${loc}`)
  const code = new URL(loc).searchParams.get('code')
  assert.ok(code, `no code in ${loc}`)
  return code
}
async function fn(client, name, body, headers = {}) {
  const { data: { session } } = await client.auth.getSession()
  const res = await fetch(`${E.api}/functions/v1/${name}`, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', apikey: E.anon, Authorization: `Bearer ${session?.access_token ?? E.anon}`, Origin: 'http://localhost:5173', ...headers } })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}
const cleanup = { users: [], groups: [] }

describe('end-to-end on a local Supabase', { skip: !ready && 'set E2E_API_URL, E2E_ANON_KEY, E2E_SERVICE_ROLE_KEY, E2E_MAILPIT_URL (see README)' }, () => {
  const parent = person(), parent2 = person(), teacher = person(), adminUser = person(), kid = person(), stranger = person()
  const st = {}

  before(async () => {
    // an admin (set up by the server side, as an operator would) – everything else goes through the real flows
    const a = admin()
    const { data, error } = await a.auth.admin.createUser({ email: mail('admin'), password: 'admin-pass-123', email_confirm: true, user_metadata: { full_name: 'מנהלת בדיקה' } })
    assert.ifError(error)
    cleanup.users.push(data.user.id)
    const r = await a.from('user_roles').insert({ user_id: data.user.id, role: 'admin', status: 'active' })
    assert.ifError(r.error)
    assert.ifError((await adminUser.auth.signInWithPassword({ email: mail('admin'), password: 'admin-pass-123' })).error)
  })
  after(async () => {
    if (!ready) return
    const a = admin()
    if (cleanup.groups.length) await a.from('groups').delete().in('id', cleanup.groups)
    for (const id of cleanup.users.reverse()) await a.auth.admin.deleteUser(id)
  })

  // ---------------- adults: sign-up, e-mail confirmation, password reset ----------------
  it('sign-up needs a confirmed e-mail; the confirmation link (PKCE) gives a session', async () => {
    const { data, error } = await parent.auth.signUp({ email: mail('parent'), password: 'parent-pass-1',
      options: { emailRedirectTo: REDIRECT, data: { full_name: 'הורה בדיקה', requested_role: 'parent' } } })
    assert.ifError(error)
    assert.equal(data.session, null, 'no session before the e-mail is confirmed')
    cleanup.users.push(data.user.id); st.parentId = data.user.id
    const early = await person().auth.signInWithPassword({ email: mail('parent'), password: 'parent-pass-1' })
    assert.match(early.error?.message ?? '', /not confirmed/i)
    const ex = await parent.auth.exchangeCodeForSession(await codeFromMail(mail('parent')))
    assert.ifError(ex.error)
    assert.equal(ex.data.session.user.id, st.parentId)
  })
  it('the role comes only from the server: parent at once; admin cannot be requested', async () => {
    assert.equal((await parent.rpc('request_role', { p_role: 'parent' })).data, 'active')
    assert.match((await parent.rpc('request_role', { p_role: 'admin' })).error?.message ?? '', /cannot be requested/)
    const roles = (await parent.from('user_roles').select('role, status')).data
    assert.deepEqual(roles, [{ role: 'parent', status: 'active' }])
  })
  it('password reset: the e-mailed link lets the user set a new password; the old one stops working', async () => {
    const asker = person()
    assert.ifError((await asker.auth.resetPasswordForEmail(mail('parent'), { redirectTo: REDIRECT })).error)
    const ex = await asker.auth.exchangeCodeForSession(await codeFromMail(mail('parent')).then(async c => c))
    assert.ifError(ex.error)
    assert.ifError((await asker.auth.updateUser({ password: 'parent-pass-2' })).error)
    assert.match((await person().auth.signInWithPassword({ email: mail('parent'), password: 'parent-pass-1' })).error?.message ?? '', /invalid/i)
    assert.ifError((await parent.auth.signInWithPassword({ email: mail('parent'), password: 'parent-pass-2' })).error)
  })
  it('a reset for an unknown address answers the same and sends nothing', async () => {
    assert.ifError((await person().auth.resetPasswordForEmail(mail('nobody'), { redirectTo: REDIRECT })).error)
    assert.equal((await inbox(mail('nobody'), { wait: 1500 })).length, 0)
  })

  // ---------------- parent phone verification (test numbers, no SMS) ----------------
  it('an unverified parent cannot create a child account', async () => {
    const r = await fn(parent, 'manage-student', { action: 'create', fullName: 'ילד בדיקה', birthDate: '2019-04-04', grade: 'א', relation: 'אמא', loginMode: 'pin', pin: '480317' })
    assert.equal(r.status, 403, JSON.stringify(r.body))
  })
  it('the parent confirms a phone with an OTP (fixed test code, nothing sent) and becomes verified', async () => {
    const up = await parent.auth.updateUser({ phone: PHONE_OK })
    assert.ifError(up.error)
    // regression (found here): a new phone must stay UNconfirmed until the code is entered
    assert.equal((await admin().rpc('srv_is_verified_parent', { p_user: st.parentId })).data, false, 'verified without an OTP!')
    const v = await parent.auth.verifyOtp({ phone: PHONE_OK, token: OTP, type: 'phone_change' })
    assert.ifError(v.error)
    assert.ok(v.data.user.phone_confirmed_at, 'phone confirmed')
    assert.equal((await admin().rpc('srv_is_verified_parent', { p_user: st.parentId })).data, true)
  })
  it('a wrong phone code does not verify', async () => {
    const { data, error } = await parent2.auth.signUp({ email: mail('parent2'), password: 'parent2-pass', options: { emailRedirectTo: REDIRECT } })
    assert.ifError(error); cleanup.users.push(data.user.id); st.parent2Id = data.user.id
    assert.ifError((await parent2.auth.exchangeCodeForSession(await codeFromMail(mail('parent2')))).error)
    await parent2.rpc('request_role', { p_role: 'parent' })
    assert.ifError((await parent2.auth.updateUser({ phone: '972500000902' })).error)
    assert.ok((await parent2.auth.verifyOtp({ phone: '972500000902', token: '000000', type: 'phone_change' })).error)
    assert.equal((await admin().rpc('srv_is_verified_parent', { p_user: st.parent2Id })).data, false)
  })

  // ---------------- child account, device, PIN sign-in ----------------
  it('the verified parent creates a child account (Edge Function → Supabase Auth admin)', async () => {
    const r = await fn(parent, 'manage-student', { action: 'create', fullName: 'ילד בדיקה', birthDate: '2019-04-04', grade: 'א', relation: 'אמא', loginMode: 'pin', pin: '480317' })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    st.kidId = r.body.studentId; cleanup.users.push(st.kidId)
    const u = (await admin().auth.admin.getUserById(st.kidId)).data.user
    assert.match(u.email, /@students\.masa-halemida\.invalid$/)
    const kids = (await parent.from('students').select('id, grade, login_mode')).data
    assert.deepEqual(kids.map(k => k.id), [st.kidId])
  })
  it('the same child again is refused; no request without a session; bad input is refused', async () => {
    const again = await fn(parent, 'manage-student', { action: 'create', fullName: ' ילד   בדיקה ', birthDate: '2019-04-04', grade: 'א', relation: 'אמא', loginMode: 'pin', pin: '572049' })
    assert.equal(again.status, 409)
    const noSession = await fetch(`${E.api}/functions/v1/manage-student`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', apikey: E.anon } })
    assert.equal(noSession.status, 401)
    assert.equal((await fn(parent, 'manage-student', { action: 'create', fullName: 'x', birthDate: '2019-04-04', grade: 'א', relation: 'אמא', loginMode: 'pin', pin: '111111' })).status, 400)
  })
  it('the parent approves this device; the token comes back once and is stored only as a hash', async () => {
    const r = await parent.rpc('enroll_device', { p_student: st.kidId, p_label: 'טאבלט בדיקה' })
    assert.ifError(r.error)
    st.device = r.data
    assert.match(st.device, /^[0-9a-f]{64}$/)
    assert.match((await parent.from('student_devices').select('token_hash')).error?.message ?? '', /permission denied/)
  })
  it('PIN sign-in: Supabase Auth issues a REAL session for the child (generateLink + verifyOtp)', async () => {
    const r = await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '480317', deviceToken: st.device })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const set = await kid.auth.setSession({ access_token: r.body.session.access_token, refresh_token: r.body.session.refresh_token })
    assert.ifError(set.error)
    assert.equal(set.data.user.id, st.kidId)
    const claims = JSON.parse(Buffer.from(r.body.session.access_token.split('.')[1], 'base64url').toString())
    assert.equal(claims.sub, st.kidId); assert.equal(claims.role, 'authenticated')
    // the session works with RLS: the child sees itself, nobody else
    assert.deepEqual((await kid.from('profiles').select('id')).data.map(p => p.id).sort(), [st.kidId, st.parentId].sort())
    assert.deepEqual((await kid.from('students').select('id')).data.map(p => p.id), [st.kidId])
    // the refresh token works like any Supabase session
    assert.ifError((await kid.auth.refreshSession()).error)
  })
  it('no e-mail was sent for the child (the magic link is created and used on the server only)', async () => {
    const u = (await admin().auth.admin.getUserById(st.kidId)).data.user
    assert.equal((await inbox(u.email, { wait: 1500 })).length, 0)
  })
  it('the child cannot take over the account: no own password, e-mail or phone (lockout and device rules stay)', async () => {
    const pw = await kid.auth.updateUser({ password: 'child-chose-this' })
    assert.ok(pw.error, 'a student must not be able to set an Auth password')
    const em = await kid.auth.updateUser({ email: mail('kid-takeover') })
    assert.ok(em.error, 'a student must not be able to change the e-mail')
    const ph = await kid.auth.updateUser({ phone: '972500000902' })
    assert.ok(ph.error, 'a student must not be able to add a phone')
    // and the direct way around the PIN stays closed: no password works for the child's address
    assert.ok((await person().auth.signInWithPassword({ email: (await admin().auth.admin.getUserById(st.kidId)).data.user.email, password: 'child-chose-this' })).error)
    const u = (await admin().auth.admin.getUserById(st.kidId)).data.user
    assert.match(u.email, /@students\.masa-halemida\.invalid$/)
    assert.equal(u.new_email ?? null, null)
  })
  it('the child cannot change its name, grade or groups through the API', async () => {
    const p = await kid.from('profiles').update({ full_name: 'שם אחר' }).eq('id', st.kidId).select('id')
    assert.deepEqual(p.data ?? [], [])
    const s = await kid.from('students').update({ grade: 'ו' }).eq('id', st.kidId).select('id')
    assert.deepEqual(s.data ?? [], [])
    assert.ok((await kid.from('groups').insert({ name: 'x', subject: 'math', grade: 'א' })).error)
  })
  it('PIN from another device, or a guessed device token, is refused with the generic answer', async () => {
    const r = await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '480317', deviceToken: 'f'.repeat(64) })
    assert.equal(r.status, 401)
    assert.deepEqual(Object.keys(r.body).sort(), ['error', 'message'])
  })
  it('5 wrong PINs lock the account; the right PIN is refused; the parent releases it', async () => {
    for (let i = 0; i < 4; i++) assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '999999', deviceToken: st.device })).status, 401)
    assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '999999', deviceToken: st.device })).status, 423)
    assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '480317', deviceToken: st.device })).status, 423)
    assert.ok((await parent2.rpc('release_student_lock', { p_student: st.kidId })).error, 'another parent cannot release')
    assert.ifError((await parent.rpc('release_student_lock', { p_student: st.kidId })).error)
    assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '480317', deviceToken: st.device })).status, 200)
  })
  it('the parent changes the PIN (old one stops); another parent cannot', async () => {
    assert.equal((await fn(parent2, 'manage-student', { action: 'set_secret', studentId: st.kidId, kind: 'pin', secret: '572049' })).status, 403)
    assert.equal((await fn(parent, 'manage-student', { action: 'set_secret', studentId: st.kidId, kind: 'pin', secret: '572049' })).status, 200)
    assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '480317', deviceToken: st.device })).status, 401)
    assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '572049', deviceToken: st.device })).status, 200)
  })
  it('revoking the device stops PIN sign-in from it AND ends the sessions already open on it (A5)', async () => {
    // a live session opened on the device, before the revoke
    const r = await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '572049', deviceToken: st.device })
    assert.equal(r.status, 200)
    assert.ifError((await kid.auth.setSession({ access_token: r.body.session.access_token, refresh_token: r.body.session.refresh_token })).error)
    assert.deepEqual((await kid.from('students').select('id')).data.map(p => p.id), [st.kidId])
    const dev = (await parent.from('student_devices').select('id')).data[0].id
    assert.ifError((await parent.rpc('revoke_device', { p_device: dev })).error)
    assert.equal((await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '572049', deviceToken: st.device })).status, 401)
    // the SAME access token is now refused by the server on REST, RPC and Storage …
    const rest = await kid.from('students').select('id')
    assert.equal(rest.status, 401, JSON.stringify(rest)); assert.equal(rest.error?.code, 'PT401')
    assert.equal((await kid.rpc('start_session', { p_assignment: '00000000-0000-4000-8000-000000000000' })).status, 401)   // refused before the function even runs
    assert.ok((await kid.storage.from('avatars').list(st.kidId)).data?.length !== 1)
    // … and a refreshed token is refused too (same session)
    await kid.auth.refreshSession()
    assert.equal((await kid.from('students').select('id')).status, 401)
    // adults are not affected
    assert.equal((await parent.from('students').select('id')).status, 200)
    // a new approved device gives the child a working session again (later tests use it)
    st.device = (await parent.rpc('enroll_device', { p_student: st.kidId, p_label: 'טאבלט חדש' })).data
    const again = await fn(stranger, 'student-login', { mode: 'pin', studentId: st.kidId, pin: '572049', deviceToken: st.device })
    assert.equal(again.status, 200)
    assert.ifError((await kid.auth.setSession({ access_token: again.body.session.access_token, refresh_token: again.body.session.refresh_token })).error)
    assert.equal((await kid.from('students').select('id')).status, 200)
  })
  it('CORS answers only the portal\'s origin', async () => {
    const ok = await fn(stranger, 'student-login', { mode: 'profiles', deviceTokens: [] })
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    const evil = await fn(stranger, 'student-login', { mode: 'profiles', deviceTokens: [] }, { Origin: 'https://evil.example' })
    assert.equal(evil.headers.get('access-control-allow-origin'), null)
  })

  // ---------------- teacher, invitation, consent, revocation (REST with real sessions) ----------------
  it('a teacher signs up and waits; an admin approves; she opens a group and invites the parent', async () => {
    const { data, error } = await teacher.auth.signUp({ email: mail('teacher'), password: 'teacher-pass', options: { emailRedirectTo: REDIRECT } })
    assert.ifError(error); cleanup.users.push(data.user.id); st.teacherId = data.user.id
    assert.ifError((await teacher.auth.exchangeCodeForSession(await codeFromMail(mail('teacher')))).error)
    assert.equal((await teacher.rpc('request_role', { p_role: 'teacher' })).data, 'pending')
    assert.ok((await teacher.from('groups').insert({ name: 'קבוצת בדיקה', subject: 'math', grade: 'א' })).error, 'pending teacher cannot create groups')
    assert.ifError((await adminUser.rpc('admin_set_role', { p_user: st.teacherId, p_role: 'teacher', p_status: 'active' })).error)
    const g = await teacher.from('groups').insert({ name: 'קבוצת בדיקה', subject: 'math', grade: 'א' }).select('id').single()
    assert.ifError(g.error); st.groupId = g.data.id; cleanup.groups.push(st.groupId)
    const inv = await teacher.rpc('create_invitation', { p_group: st.groupId, p_parent_email: mail('parent').toUpperCase(), p_child_hint: 'ילד' })
    assert.ifError(inv.error); st.invId = inv.data
    assert.deepEqual((await teacher.from('students').select('id')).data, [])
  })
  it('the parent sees the invitation and the group (not its students), and approves for the own child only', async () => {
    assert.deepEqual((await parent.from('invitations').select('id')).data.map(i => i.id), [st.invId])
    assert.deepEqual((await parent.from('groups').select('name')).data, [{ name: 'קבוצת בדיקה' }])
    assert.deepEqual((await parent2.from('invitations').select('id')).data, [])
    assert.ok((await parent2.rpc('respond_invitation', { p_invitation: st.invId, p_accept: true, p_student: st.kidId })).error)
    const r = await parent.rpc('respond_invitation', { p_invitation: st.invId, p_accept: true, p_student: st.kidId })
    assert.ifError(r.error); st.consentId = r.data
  })
  it('now the teacher sees the child – and loses it the moment the parent revokes consent', async () => {
    assert.deepEqual((await teacher.from('students').select('id')).data.map(s => s.id), [st.kidId])
    assert.match((await teacher.from('students').select('birth_date')).error?.message ?? '', /permission denied/)
    assert.ifError((await parent.rpc('revoke_consent', { p_consent: st.consentId })).error)
    assert.deepEqual((await teacher.from('students').select('id')).data, [])
    assert.deepEqual((await teacher.from('profiles').select('id').eq('id', st.kidId)).data, [])
  })

  // ---------------- learning materials (real Storage, real functions) ----------------
  it('materials: upload only to the server-chosen path; file type enforced by Storage; students never upload', async () => {
    const pdf = new Blob([Uint8Array.from(Buffer.from('%PDF-1.4\n% test\n'))], { type: 'application/pdf' })
    const m = (await teacher.rpc('create_material', { p_title: 'דף בדיקה', p_mime: 'application/pdf', p_size: pdf.size })).data
    assert.match(m.path, new RegExp(`^${st.teacherId}/${m.id}/source\\.pdf$`))
    assert.ok((await teacher.storage.from('materials').upload(`${st.teacherId}/${m.id}/other.pdf`, pdf)).error, 'any other path is refused')
    assert.ok((await teacher.storage.from('materials').upload(m.path, new Blob(['<html>'], { type: 'text/html' }))).error, 'Storage refuses a non-allowed type')
    assert.ifError((await teacher.storage.from('materials').upload(m.path, pdf)).error)
    assert.ok((await kid.rpc('create_material', { p_title: 'x', p_mime: 'application/pdf', p_size: 10 })).error)
    assert.ok((await kid.storage.from('materials').upload(m.path, pdf, { upsert: true })).error)
    st.material = m
  })
  it('materials: unshared files are private; generate-content answers honestly that AI is not configured', async () => {
    assert.ok((await parent.storage.from('materials').createSignedUrl(st.material.path, 60)).error, 'not shared → no access')
    const signed = await teacher.storage.from('materials').createSignedUrl(st.material.path, 60)
    assert.ifError(signed.error)
    assert.equal((await fetch(signed.data.signedUrl)).status, 200)
    const r = await fn(teacher, 'generate-content', { materialId: st.material.id })
    assert.equal(r.status, 503, JSON.stringify(r.body)); assert.equal(r.body.error, 'ai_unavailable')
    assert.equal((await fn(parent, 'generate-content', { materialId: st.material.id })).status, 403)       // not the owner
  })
  it('materials: a parent shares with own child only; the child reads it, the teacher does not', async () => {
    const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
    const m = (await parent.rpc('create_material', { p_title: 'שיעורי בית', p_mime: 'image/png', p_size: png.size })).data
    assert.ifError((await parent.storage.from('materials').upload(m.path, png)).error)
    assert.ok((await parent2.rpc('share_material', { p_material: m.id, p_group: null, p_student: st.kidId })).error, 'not the owner')
    assert.ifError((await parent.rpc('share_material', { p_material: m.id, p_group: null, p_student: st.kidId })).error)
    const kidUrl = await kid.storage.from('materials').createSignedUrl(m.path, 60)
    assert.ifError(kidUrl.error)
    assert.equal((await fetch(kidUrl.data.signedUrl)).status, 200)
    assert.ok((await teacher.storage.from('materials').createSignedUrl(m.path, 60)).error)
    assert.ok((await stranger.storage.from('materials').createSignedUrl(m.path, 60)).error)
  })

  // ---------------- private profile pictures (real Storage) ----------------
  it('Storage: a picture needs the photo consent; the child itself cannot upload', async () => {
    const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
    const path = `${st.kidId}/face.png`
    assert.ok((await parent.storage.from('avatars').upload(path, png)).error, 'no photo consent yet')
    assert.ifError((await parent.rpc('grant_consent', { p_student: st.kidId, p_scope: 'photo', p_text_version: 'photo-v1' })).error)
    assert.ifError((await parent.storage.from('avatars').upload(path, png)).error)
    assert.ok((await kid.storage.from('avatars').upload(`${st.kidId}/me.png`, png)).error, 'students never upload')
    assert.ok((await stranger.storage.from('avatars').createSignedUrl(path, 60)).error, 'signed-out visitors get nothing')
    const signed = await parent.storage.from('avatars').createSignedUrl(path, 60)
    assert.ifError(signed.error)
    assert.equal((await fetch(signed.data.signedUrl)).status, 200)
    assert.ifError((await parent.storage.from('avatars').remove([path])).error)
  })
})
