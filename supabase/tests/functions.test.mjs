// Tests for the Edge Function logic (supabase/functions/_shared/*.ts, loaded by Node's type stripping).
// Part 1: units with fakes. Part 2: the same logic against the local test database (real SQL functions,
// real limits) – only Supabase Auth itself is replaced by a fake, so the session step is NOT tested here.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hashSecret, verifySecret, sha256Hex, DUMMY_HASH } from '../functions/_shared/secrets.ts'
import { checkBirthDate, checkPin, checkUsername, InputError } from '../functions/_shared/validate.ts'
import { studentLogin } from '../functions/_shared/studentLogin.ts'
import { createStudent, setStudentSecret, ConflictError, ForbiddenError } from '../functions/_shared/manageStudent.ts'
import { corsHeaders, errorResponse } from '../functions/_shared/http.ts'
import { startDb, tx, U } from './db.mjs'

const FAST = 1000   // PBKDF2 iterations in tests only (production: 600 000)

describe('secrets', () => {
  it('hash and verify round-trip; the wrong secret and a tampered hash fail', async () => {
    const h = await hashSecret('480317', FAST)
    assert.match(h, /^pbkdf2-sha256\$1000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
    assert.equal(await verifySecret('480317', h), true)
    assert.equal(await verifySecret('480318', h), false)
    assert.equal(await verifySecret('480317', h.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))), false)
    assert.equal(await verifySecret('480317', 'plain-text'), false)
    assert.equal(await verifySecret('480317', h.replace('$1000$', '$1$')), false)   // absurd cost refused
  })
  it('two hashes of the same PIN differ (random salt)', async () => {
    assert.notEqual(await hashSecret('480317', FAST), await hashSecret('480317', FAST))
  })
  it('the dummy hash never verifies', async () => { assert.equal(await verifySecret('', DUMMY_HASH), false) })
})

describe('input checks', () => {
  it('rejects weak or malformed PINs', () => {
    for (const p of ['111111', '123456', '654321', '012345', '12345', 'abcdef', 480317]) assert.throws(() => checkPin(p), InputError, String(p))
    assert.equal(checkPin('480317'), '480317')
  })
  it('usernames are normalised and limited', () => {
    assert.equal(checkUsername('  Tamar.Levi '), 'tamar.levi')
    for (const u of ['ab', 'תמר', 'a b c', 'x'.repeat(33)]) assert.throws(() => checkUsername(u), InputError)
  })
  it('birth dates fit kindergarten to 6th grade', () => {
    const today = new Date('2026-11-09T00:00:00Z')
    assert.equal(checkBirthDate('2018-03-01', today), '2018-03-01')
    for (const d of ['2025-01-01', '2005-01-01', '2018-13-01', 'yesterday']) assert.throws(() => checkBirthDate(d, today), InputError, d)
  })
})

describe('http helpers', () => {
  it('CORS answers only listed origins', () => {
    assert.equal(corsHeaders('http://localhost:5173', 'http://localhost:5173')['Access-Control-Allow-Origin'], 'http://localhost:5173')
    assert.equal(corsHeaders('https://evil.example', 'http://localhost:5173')['Access-Control-Allow-Origin'], undefined)
  })
  it('internal errors are not leaked to the client', async () => {
    const r = errorResponse(new Error('relation "student_credentials" … secret_hash'), {})
    assert.equal(r.status, 500)
    assert.doesNotMatch(await r.text(), /secret_hash|student_credentials/)
  })
})

describe('student login flow (fakes)', () => {
  const fake = (over = {}) => {
    const calls = []
    const deps = {
      db: {
        lookup: async (...a) => { calls.push(['lookup', ...a]); return { student_id: 'st', secret_hash: 'H', email: 's@x.invalid' } },
        gate: async (...a) => { calls.push(['gate', ...a]); return { allowed: true } },
        record: async (...a) => { calls.push(['record', ...a]); return a[2] ? { ok: true } : { ok: false, remaining: 4 } },
        deviceProfiles: async h => { calls.push(['profiles', h]); return [] },
        ...over.db,
      },
      auth: { sessionFor: async e => { calls.push(['session', e]); return { access_token: 'a', refresh_token: 'r', expires_in: 3600 } } },
      verify: over.verify ?? (async s => s === '480317'),
    }
    return { deps, calls }
  }
  const pin = (p = '480317') => ({ mode: 'pin', studentId: U.S1, pin: p, deviceToken: 'a'.repeat(64) })

  it('a right PIN: Supabase Auth is asked for a session only after the check, and the success is recorded', async () => {
    const { deps, calls } = fake()
    const r = await studentLogin(pin(), 'ip', deps)
    assert.equal(r.status, 200)
    assert.deepEqual(calls.map(c => c[0]), ['gate', 'lookup', 'gate', 'record', 'session'])
    assert.equal(calls.find(c => c[0] === 'record')[3], true)
  })
  it('a wrong PIN never reaches Supabase Auth', async () => {
    const { deps, calls } = fake()
    const r = await studentLogin(pin('480318'), 'ip', deps)
    assert.equal(r.status, 401)
    assert.ok(!calls.some(c => c[0] === 'session'))
  })
  it('a locked account is refused before the secret is even checked', async () => {
    let verified = false
    const { deps } = fake({ db: { gate: async st => (st ? { allowed: false, reason: 'locked', until: 'later' } : { allowed: true }) }, verify: async () => { verified = true; return true } })
    const r = await studentLogin(pin(), 'ip', deps)
    assert.equal(r.status, 423)
    assert.equal(verified, false)
  })
  it('an unknown account gets the same answer as a wrong PIN', async () => {
    const { deps, calls } = fake({ db: { lookup: async () => null }, verify: async () => false })
    const r = await studentLogin(pin(), 'ip', deps)
    assert.deepEqual(r, { status: 401, body: { error: 'wrong', message: 'הפרטים לא נכונים. נסו שוב' } })
    assert.deepEqual(calls.find(c => c[0] === 'record').slice(1), [null, 'ip', false, null])
  })
  it('malformed requests are refused without touching the database', async () => {
    const { deps, calls } = fake()
    for (const bad of [{}, { mode: 'admin' }, { ...pin(), studentId: 'x' }, { ...pin(), deviceToken: 'short' }, { mode: 'password', username: 'a' }]) {
      await assert.rejects(studentLogin(bad, 'ip', deps), InputError)
    }
    assert.equal(calls.length, 0)
  })
  it('the picture grid ignores anything that is not a device token', async () => {
    const { deps, calls } = fake()
    await studentLogin({ mode: 'profiles', deviceTokens: ['a'.repeat(64), 'nope', 5, "' or 1=1 --"] }, 'ip', deps)
    assert.equal(calls.find(c => c[0] === 'profiles')[1].length, 1)
  })
})

describe('against the local database', () => {
  let db
  const IP = 'a'.repeat(64)          // a hashed client address (the function stores only sha-256 hashes)
  before(async () => { db = await startDb() })
  after(async () => { await db?.stop() })
  const t = fn => () => tx(db.client, fn)

  // the Edge Functions' dependencies, wired to the test transaction: service role for srv_*, owner to fake Auth
  function wire(s, authLog = []) {
    const svc = async (sql, p) => { await s.asService(); return s.rows(sql, p) }
    const login = {
      db: {
        lookup: async (m, u, st, d) => (await svc('select * from public.srv_login_lookup($1,$2,$3,$4)', [m, u, st, d]))[0] ?? null,
        gate: async (st, ip) => (await svc('select public.srv_login_gate($1,$2) as g', [st, ip]))[0].g,
        record: async (st, ip, ok, d) => (await svc('select public.srv_login_record($1,$2,$3,$4) as r', [st, ip, ok, d]))[0].r,
        deviceProfiles: async h => svc('select * from public.srv_device_profiles($1)', [h]),
      },
      auth: { sessionFor: async email => { authLog.push(['session', email]); return { access_token: 'fake', refresh_token: 'fake', expires_in: 1 } } },
    }
    const manage = {
      iterations: FAST,
      isVerifiedParent: async id => (await svc('select public.srv_is_verified_parent($1) as v', [id]))[0].v,
      db: {
        findDuplicate: async (p, n, d) => (await svc('select public.srv_find_duplicate_child($1,$2,$3) as id', [p, n, d]))[0].id,
        usernameTaken: async u => (await svc('select public.srv_username_taken($1) as t', [u]))[0].t,
        register: async a => { await svc('select public.srv_register_student($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [a.parentId, a.studentId, a.fullName, a.birthDate, a.grade, a.loginMode, a.username, a.secretHash, a.relation]) },
        setSecret: async (p, st, h) => { await svc('select public.srv_set_secret($1,$2,$3)', [p, st, h]) },
      },
      auth: {
        createUser: async (email, _pw, fullName) => {
          authLog.push(['createUser', email])
          await s.asOwner()
          return (await s.rows(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2) returning id`, [email, { full_name: fullName }]))[0].id
        },
        deleteUser: async id => { authLog.push(['deleteUser', id]); await s.asOwner(); await s.rows('delete from auth.users where id = $1', [id]) },
      },
    }
    return { login, manage }
  }
  const kid = (o = {}) => ({ fullName: 'ילד  חדש', birthDate: '2019-04-04', grade: 'א', relation: 'אמא', loginMode: 'pin', pin: '480317', ...o })

  it('a verified parent creates a child account; everything is linked and verified', t(async s => {
    const { manage } = wire(s)
    const { studentId } = await createStudent(U.P1, kid(), manage)
    await s.asOwner()
    assert.equal((await s.one('select full_name from public.profiles where id = $1', [studentId])).full_name, 'ילד חדש')
    assert.deepEqual(await s.rows('select role, status from public.user_roles where user_id = $1', [studentId]), [{ role: 'student', status: 'active' }])
    assert.equal((await s.one('select count(*)::int n from public.guardianships where parent_id = $1 and student_id = $2 and verified_at is not null', [U.P1, studentId])).n, 1)
    assert.match((await s.one('select secret_hash from public.student_credentials where student_id = $1', [studentId])).secret_hash, /^pbkdf2-sha256\$/)
    assert.match((await s.one('select email from auth.users where id = $1', [studentId])).email, /^s-[0-9a-f-]{36}@students\.masa-halemida\.invalid$/)
  }))
  it('the same child twice (any spacing or case) is refused, and no half-made account is left', t(async s => {
    const log = []
    const { manage } = wire(s, log)
    await createStudent(U.P1, kid({ fullName: 'Dana Cohen' }), manage)
    await assert.rejects(createStudent(U.P1, kid({ fullName: '  dana   COHEN ' }), manage), ConflictError)
    await s.asOwner()
    assert.equal((await s.one(`select count(*)::int n from auth.users where email like '%students.masa-halemida.invalid'`)).n, 1)
  }))
  it('the database refuses a duplicate even if the early check is skipped (race)', t(async s => {
    const log = []
    const { manage } = wire(s, log)
    await createStudent(U.P1, kid(), manage)
    manage.db.findDuplicate = async () => null           // pretend two requests passed the early check together
    await assert.rejects(createStudent(U.P1, kid(), manage), ConflictError)
    assert.equal(log.filter(x => x[0] === 'deleteUser').length, 1)   // the second auth user was removed again
  }))
  it('an unverified parent cannot create a child – nothing is created in Auth', t(async s => {
    const log = []
    await assert.rejects(createStudent(U.P3, kid(), wire(s, log).manage), ForbiddenError)
    assert.equal(log.length, 0)
  }))
  it('the database itself refuses an unverified parent (defence in depth)', t(async s => {
    await s.asService()
    const e = await s.fails(`select public.srv_register_student($1, $2, 'x y', '2019-01-01', 'א', 'pin', null, 'pbkdf2-sha256$1000$aa$bb', 'אמא')`, [U.P3, U.S4])
    assert.match(e.message, /verified parent/)
  }))
  it('a taken username is refused', t(async s => {
    await assert.rejects(createStudent(U.P1, kid({ loginMode: 'password', username: 'Student.Two', password: 'long-enough-pw' }), wire(s).manage), ConflictError)
  }))
  it('users can never call the service functions', t(async s => {
    for (const who of [U.P1, U.T1, U.S1, U.A]) {
      await s.as(who)
      for (const q of [`select public.srv_login_lookup('pin', null, $1, null)`, `select public.srv_set_secret($1, $1, 'x')`, `select public.srv_is_verified_parent($1)`]) {
        assert.match((await s.fails(q, [who])).message, /permission denied/, `${who}: ${q}`)
      }
    }
    await s.as('anon')
    assert.match((await s.fails(`select public.srv_login_record(null, null, true)`)).message, /permission denied/)
  }))

  // a PIN child with an approved device
  async function pinChild(s) {
    const { manage, login } = wire(s)
    const { studentId } = await createStudent(U.P1, kid(), manage)
    await s.as(U.P1)
    const token = (await s.one('select public.enroll_device($1, $2) as t', [studentId, 'טאבלט'])).t
    return { studentId, token, login, manage }
  }
  const req = (studentId, token, p = '480317') => ({ mode: 'pin', studentId, pin: p, deviceToken: token })

  it('PIN sign-in works only from the approved device', t(async s => {
    const log = []
    const { studentId, token } = await pinChild(s)
    const { login } = wire(s, log)
    assert.equal((await studentLogin(req(studentId, token), IP, login)).status, 200)
    assert.equal((await studentLogin(req(studentId, 'b'.repeat(64)), IP, login)).status, 401)
    assert.equal(log.filter(x => x[0] === 'session').length, 1)
  }))
  it('5 wrong PINs lock for 15 minutes – even the right PIN is refused; a parent releases it', t(async s => {
    const { studentId, token, login } = await pinChild(s)
    for (let i = 0; i < 4; i++) assert.equal((await studentLogin(req(studentId, token, '999999'), IP, login)).status, 401)
    assert.equal((await studentLogin(req(studentId, token, '999999'), IP, login)).status, 423)
    assert.equal((await studentLogin(req(studentId, token), IP, login)).body.error, 'locked')
    await s.as(U.P2)
    assert.match((await s.fails('select public.release_student_lock($1)', [studentId])).message, /only a parent/)
    await s.as(U.S1)
    assert.match((await s.fails('select public.release_student_lock($1)', [studentId])).message, /only a parent/)
    await s.as(U.P1)
    await s.rows('select public.release_student_lock($1)', [studentId])
    assert.equal((await studentLogin(req(studentId, token), IP, login)).status, 200)
  }))
  it('10 wrong PINs need a parent, even after the 15 minutes', t(async s => {
    const { studentId, token, login } = await pinChild(s)
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 5; i++) await studentLogin(req(studentId, token, '999999'), IP, login)
      await s.asOwner(); await s.rows(`update public.student_credentials set locked_until = now() - interval '1 second' where student_id = $1`, [studentId])
    }
    const r = await studentLogin(req(studentId, token), IP, login)
    assert.equal(r.body.error, 'needs_parent')
  }))
  it('a revoked device stops working', t(async s => {
    const { studentId, token, login } = await pinChild(s)
    await s.as(U.P1)
    const dev = (await s.one('select id from public.student_devices where student_id = $1', [studentId])).id
    await s.rows('select public.revoke_device($1)', [dev])
    assert.equal((await studentLogin(req(studentId, token), IP, login)).status, 401)
  }))
  it('only a verified parent of the child can approve a device; nobody can read device tokens', t(async s => {
    const { studentId } = await pinChild(s)
    await s.as(U.P2)
    assert.match((await s.fails('select public.enroll_device($1)', [studentId])).message, /verified parent/)
    await s.as(U.T1)
    assert.match((await s.fails('select public.enroll_device($1)', [studentId])).message, /verified parent/)
    await s.as(U.P1)
    assert.match((await s.fails('select token_hash from public.student_devices')).message, /permission denied/)
    assert.equal((await s.rows('select id, label from public.student_devices')).length, 1)
  }))
  it('the picture grid shows only children approved on this device', t(async s => {
    const { token, login } = await pinChild(s)
    const r = await studentLogin({ mode: 'profiles', deviceTokens: [token, 'c'.repeat(64)] }, IP, login)
    assert.deepEqual(r.body.profiles.map(p => p.firstName), ['ילד'])
  }))
  it('older students sign in with username + password (case-insensitive username)', t(async s => {
    const log = []
    const { manage, login } = wire(s, log)
    await createStudent(U.P1, kid({ fullName: 'נערה גדולה', birthDate: '2015-02-02', grade: 'ה', loginMode: 'password', username: 'big.girl', password: 'a-long-password' }), manage)
    assert.equal((await studentLogin({ mode: 'password', username: 'Big.Girl', password: 'a-long-password' }, IP, login)).status, 200)
    assert.equal((await studentLogin({ mode: 'password', username: 'big.girl', password: 'wrong-password' }, IP, login)).status, 401)
  }))
  it('a parent changes the PIN; the old one stops working; another parent cannot', t(async s => {
    const { studentId, token, login, manage } = await pinChild(s)
    await setStudentSecret(U.P1, { studentId, kind: 'pin', secret: '572049' }, manage)
    assert.equal((await studentLogin(req(studentId, token), IP, login)).status, 401)
    assert.equal((await studentLogin(req(studentId, token, '572049'), IP, login)).status, 200)
    await assert.rejects(setStudentSecret(U.P2, { studentId, kind: 'pin', secret: '572049' }, manage), ForbiddenError)
  }))
  it('at most 30 attempts per address in 15 minutes', t(async s => {
    const { studentId, token, login } = await pinChild(s)
    const ip = await sha256Hex('203.0.113.7')
    await s.asOwner()
    await s.rows(`insert into public.login_attempts (ip_hash, ok) select $1, false from generate_series(1, 30)`, [ip])
    assert.equal((await studentLogin(req(studentId, token), ip, login)).status, 429)
    assert.equal((await studentLogin(req(studentId, token), await sha256Hex('198.51.100.1'), login)).status, 200)
  }))
})
