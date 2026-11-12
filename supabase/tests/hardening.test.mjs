// Phase 5 security audit – a regression test for every finding, plus OCR confidence, draft editing and AI safeguards.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { startDb, tx, U } from './db.mjs'

let db
before(async () => { db = await startDb() })
after(async () => { await db?.stop() })
const t = fn => () => tx(db.client, fn)
const PACK = { schema: 'masa-pack/1', subject: { name: 'מדעים' }, topics: [{ id: 't1', name: 'מים' }],
  pools: { p1: { defaults: { type: 'choice' }, items: [
    { id: 'q1', text: 'שאלה 1', options: ['א', 'ב'], answer: 'ב' },
    { id: 'q2', text: 'שאלה 2', options: ['ג'.repeat(300), 'ד'], answer: 'ג'.repeat(300) },
    { id: 'q3', text: 'שאלה 3', options: ['ה', 'ו'], answer: 'ה' }] } } }
async function published(s, kind = 'practice') {
  await s.as(U.T1)
  const a = (await s.one(`insert into public.assignments (group_id, title, kind, player_path) values ($1, 'x', $2, $3) returning id`, [U.G1, kind, kind === 'practice' ? 'math/' : null])).id
  if (kind === 'quiz') {
    const it = (await s.one(`insert into public.assignment_items (assignment_id, position, prompt, options) values ($1, 1, 'q', '{א,ב}') returning id`, [a])).id
    await s.rows(`insert into public.assignment_answer_keys values ($1, 0)`, [it])
  }
  await s.rows(`select public.publish_assignment($1)`, [a])
  return a
}
async function draft(s, approve = true) {
  await s.as(U.T1)
  const m = (await s.one(`select public.create_material('דף', 'application/pdf', 100) as r`)).r
  const d = (await s.one(`select public.save_content_draft($1, $2, 'template') as id`, [m.id, JSON.stringify(PACK)])).id
  if (approve) await s.rows(`select public.review_content_draft($1, true)`, [d])
  return { m, d }
}

describe('audit findings (regressions)', () => {
  it('A1 sessions: at most 200 per student per day', t(async s => {
    const a = await published(s)
    await s.asOwner()
    await s.rows(`insert into public.learning_sessions (student_id, source) select $1, 'player' from generate_series(1, 200)`, [U.S1])
    await s.as(U.S1)
    assert.match((await s.fails(`select public.start_session($1)`, [a])).message, /too many sessions today/)
  }))
  it('A1 events: at most 3000 per session', t(async s => {
    const a = await published(s)
    await s.as(U.S1)
    const sid = (await s.one(`select public.start_session($1) as id`, [a])).id
    await s.asOwner()
    await s.rows(`insert into public.progress_events (id, session_id, student_id, kind) select gen_random_uuid(), $1, $2, 'question' from generate_series(1, 2999)`, [sid, U.S1])
    await s.as(U.S1)
    const two = JSON.stringify([{ id: randomUUID(), kind: 'question', ok: true }, { id: randomUUID(), kind: 'question', ok: true }])
    assert.match((await s.fails(`select public.record_progress($1, $2)`, [sid, two])).message, /session is full/)
  }))
  it('A1 devices: at most 10 active per child', t(async s => {
    await s.as(U.P1)
    for (let i = 0; i < 10; i++) await s.rows(`select public.enroll_device($1)`, [U.S1])
    assert.match((await s.fails(`select public.enroll_device($1)`, [U.S1])).message, /at most 10/)
  }))
  it('A1 invitations: at most 100 per teacher per day', t(async s => {
    await s.asOwner()
    await s.rows(`insert into public.invitations (group_id, invited_by, contact_hash) select $1, $2, repeat('a', 64) from generate_series(1, 100)`, [U.G1, U.T1])
    await s.as(U.T1)
    assert.match((await s.fails(`select public.create_invitation($1, 'x@y.example', 'x')`, [U.G1])).message, /too many invitations/)
  }))
  it('A1 drafts: at most 30 per material', t(async s => {
    const { m } = await draft(s, false)
    for (let i = 0; i < 29; i++) await s.rows(`select public.save_content_draft($1, $2, 'template')`, [m.id, JSON.stringify(PACK)])
    assert.match((await s.fails(`select public.save_content_draft($1, $2, 'template')`, [m.id, JSON.stringify(PACK)])).message, /too many drafts/)
  }))
  it('A2 a quiz cannot receive practice telemetry (no "practised" quiz)', t(async s => {
    const q = await published(s, 'quiz')
    await s.as(U.S1)
    assert.match((await s.fails(`select public.start_session($1)`, [q])).message, /answered, not practised/)
    await s.rows(`select public.submit_quiz($1, '{0}')`, [q])
    assert.equal((await s.one(`select state from public.assignment_status where assignment_id = $1`, [q])).state, 'completed')
  }))
  it('A3 a client cannot label a draft as AI content (the label is set by the server)', t(async s => {
    await s.as(U.T1)
    const m = (await s.one(`select public.create_material('דף', 'application/pdf', 100) as r`)).r
    const d = (await s.one(`select public.save_content_draft($1, $2, 'template') as id`, [m.id, JSON.stringify({ ...PACK, generator: { kind: 'ai', provider: 'anthropic' } })])).id
    assert.deepEqual((await s.one(`select provider, pack -> 'generator' as g from public.content_drafts where id = $1`, [d])), { provider: 'template', g: { kind: 'template' } })
  }))
  it('A4 quiz from a draft: options and prompts are bounded; only chosen questions; other teachers cannot', t(async s => {
    const { d } = await draft(s)
    const a = (await s.one(`select public.quiz_from_draft($1, $2, 'בוחן', '{p1/q2,p1/q3}') as id`, [d, U.G1])).id
    const items = await s.rows(`select prompt, options from public.assignment_items where assignment_id = $1 order by position`, [a])
    assert.deepEqual(items.map(i => i.prompt), ['שאלה 2', 'שאלה 3'])
    assert.equal(items[0].options[0].length, 200)
    assert.equal((await s.one(`select k.answer_index from public.assignment_answer_keys k join public.assignment_items i on i.id = k.item_id where i.assignment_id = $1 and i.position = 1`, [a])).answer_index, 0)
    await s.as(U.T2)
    assert.match((await s.fails(`select public.quiz_from_draft($1, $2, 'x')`, [d, U.G2])).message, /not your draft/)
  }))
})

describe('draft review, OCR confidence', () => {
  it('a draft can be edited before approval – the provider label stays and "edited" is recorded; not after approval', t(async s => {
    const { d } = await draft(s, false)
    await s.rows(`select public.update_content_draft($1, $2)`, [d, JSON.stringify({ ...PACK, topics: [{ id: 't1', name: 'מים – ערוך' }] })])
    assert.deepEqual((await s.one(`select pack -> 'generator' as g, pack -> 'topics' -> 0 ->> 'name' as n from public.content_drafts where id = $1`, [d])), { g: { kind: 'template', edited: true }, n: 'מים – ערוך' })
    await s.rows(`select public.review_content_draft($1, true)`, [d])
    assert.match((await s.fails(`select public.update_content_draft($1, $2)`, [d, JSON.stringify(PACK)])).message, /only a draft/)
    await s.as(U.T2)
    assert.match((await s.fails(`select public.update_content_draft($1, $2)`, [d, JSON.stringify(PACK)])).message, /not your draft/)
  }))
  it('OCR confidence is stored (clamped) and readable; images start as "pending" (OCR in the browser)', t(async s => {
    await s.as(U.P1)
    const m = (await s.one(`select public.create_material('צילום', 'image/png', 100) as r`)).r
    assert.equal((await s.one(`select extraction_status from public.learning_materials where id = $1`, [m.id])).extraction_status, 'pending')
    await s.rows(`select public.save_extraction($1, 'טקסט', 1, 140)`, [m.id])
    assert.equal((await s.one(`select extraction_confidence from public.learning_materials where id = $1`, [m.id])).extraction_confidence, 100)
  }))
})

describe('AI spending safeguards', () => {
  const reserve = (s, tokens = 1000, daily = 3, budget = 10000) => s.one(`select public.srv_ai_reserve($1, null, $2, $3, $4) as r`, [U.T1, tokens, daily, budget]).then(x => x.r)
  it('no budget configured → no AI at all', t(async s => {
    await s.asService()
    assert.deepEqual(await reserve(s, 1000, 3, 0), { ok: false, reason: 'no_budget' })
  }))
  it('daily limit per user; failed requests count too', t(async s => {
    await s.asService()
    for (let i = 0; i < 3; i++) { const r = await reserve(s); assert.equal(r.ok, true); await s.rows(`select public.srv_ai_finish($1, false, 0, 0)`, [r.id]) }
    assert.deepEqual(await reserve(s), { ok: false, reason: 'daily_limit' })
  }))
  it('monthly token budget (reservations count until finished)', t(async s => {
    await s.asService()
    assert.equal((await reserve(s, 6000, 10)).ok, true)
    assert.deepEqual(await reserve(s, 6000, 10), { ok: false, reason: 'monthly_budget' })
  }))
  it('users can never touch the AI accounting', t(async s => {
    for (const who of [U.T1, U.P1, U.S1]) {
      await s.as(who)
      assert.match((await s.fails(`select public.srv_ai_reserve($1, null, 1, 100, 100000)`, [who])).message, /permission denied/)
      assert.match((await s.fails(`select * from public.ai_requests`)).message, /permission denied/)
    }
  }))
})

// A5 (Phase 5.1): revoking a child's device did not end the sessions already opened on it.
describe('A5 – revoking a device ends its sessions on the server', () => {
  const sha = x => createHash('sha256').update(x).digest('hex')
  /** act as the student with a REAL-looking token: role authenticated + sub + session_id */
  const asStudentSession = async (s, student, sid) => {
    await s.asOwner()
    await s.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: student, role: 'authenticated', ...(sid ? { session_id: sid } : {}) })])
    await s.rows('set local role authenticated')
  }
  const ok = async s => (await s.one('select app.student_session_ok() as v')).v
  async function enrolled(s) {
    await s.as(U.P1)
    const token = (await s.one('select public.enroll_device($1) as t', [U.S1])).t
    const dev = (await s.one('select id from public.student_devices where student_id = $1 order by created_at desc limit 1', [U.S1])).id
    return { hash: sha(token), dev }
  }

  it('a session bound to an approved device works; after the parent revokes the device it is refused', t(async s => {
    const { hash, dev } = await enrolled(s)
    const sid = randomUUID()
    await s.asService(); await s.rows('select public.srv_bind_student_session($1, $2, $3)', [sid, U.S1, hash])
    await asStudentSession(s, U.S1, sid)
    assert.equal(await ok(s), true)
    await s.rows('select app.check_request()')                                   // the PostgREST hook lets it through
    await s.as(U.P1); await s.rows('select public.revoke_device($1)', [dev])
    await asStudentSession(s, U.S1, sid)
    assert.equal(await ok(s), false)
    const e = await s.fails('select app.check_request()')
    assert.equal(e.code, 'PT401')                                                  // → HTTP 401 on every REST/RPC call
  }))

  it('fails closed: an unbound session, a missing session_id or another student\'s binding is refused', t(async s => {
    const { hash } = await enrolled(s)
    const sid = randomUUID()
    await s.asService(); await s.rows('select public.srv_bind_student_session($1, $2, $3)', [sid, U.S1, hash])
    await asStudentSession(s, U.S1, randomUUID()); assert.equal(await ok(s), false)
    await asStudentSession(s, U.S1, null); assert.equal(await ok(s), false)
    await asStudentSession(s, U.S2, sid); assert.equal(await ok(s), false)
  }))

  it('adults and anonymous callers are not affected', t(async s => {
    for (const who of [U.P1, U.T1, U.A1].filter(Boolean)) { await s.as(who); assert.equal(await ok(s), true); await s.rows('select app.check_request()') }
    await s.as('anon'); assert.equal(await ok(s), true); await s.rows('select app.check_request()')
  }))

  it('binding: only the server; a PIN child needs an approved, non-revoked device of THEIR OWN', t(async s => {
    const { hash, dev } = await enrolled(s)
    for (const who of [U.S1, U.P1]) {
      await s.as(who)
      assert.match((await s.fails('select public.srv_bind_student_session($1, $2, $3)', [randomUUID(), U.S1, hash])).message, /permission denied/)
      assert.match((await s.fails('select * from public.student_sessions')).message, /permission denied/)
    }
    await s.asService()
    assert.match((await s.fails('select public.srv_bind_student_session($1, $2, null)', [randomUUID(), U.S1])).message, /approved device/)
    assert.match((await s.fails('select public.srv_bind_student_session($1, $2, $3)', [randomUUID(), U.S4, hash])).message, /not approved/)
    await s.as(U.P1); await s.rows('select public.revoke_device($1)', [dev])
    await s.asService()
    assert.match((await s.fails('select public.srv_bind_student_session($1, $2, $3)', [randomUUID(), U.S1, hash])).message, /not approved/)
    await s.rows('select public.srv_bind_student_session($1, $2, null)', [randomUUID(), U.S2])   // username+password child: no device
  }))

  it('storage: a revoked session cannot read the child\'s picture', t(async s => {
    const { hash, dev } = await enrolled(s)
    const sid = randomUUID()
    await s.asOwner(); await s.rows(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U.S1}/me.png`])
    await s.asService(); await s.rows('select public.srv_bind_student_session($1, $2, $3)', [sid, U.S1, hash])
    await asStudentSession(s, U.S1, sid)
    assert.equal((await s.rows(`select 1 from storage.objects where bucket_id = 'avatars'`)).length, 1)
    await s.as(U.P1); await s.rows('select public.revoke_device($1)', [dev])
    await asStudentSession(s, U.S1, sid)
    assert.equal((await s.rows(`select 1 from storage.objects where bucket_id = 'avatars'`)).length, 0)
  }))

  it('the login flow binds the session and never returns the session id to the client', async () => {
    const { sessionIdOf } = await import('../functions/_shared/secrets.ts')
    const id = randomUUID(), b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
    assert.equal(sessionIdOf(`${b64({ alg: 'HS256' })}.${b64({ sub: 'x', session_id: id })}.sig`), id)
    for (const bad of ['', 'a.b.c', `${b64({})}.${b64({ session_id: 'not-a-uuid' })}.s`]) assert.equal(sessionIdOf(bad), null)
  })
})
