// Phase 3: assignments, sessions, progress, server-graded quizzes – RLS + RPC security tests.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, tx, U } from './db.mjs'

let db
before(async () => { db = await startDb() })
after(async () => { await db?.stop() })
const t = fn => () => tx(db.client, fn)

/** T1 makes a quiz in G1 with 3 questions (answers 1, 0, 2) and optionally publishes it */
async function quiz(s, publish = true) {
  await s.as(U.T1)
  const a = (await s.one(`insert into public.assignments (group_id, title, kind, due_at) values ($1, 'מבחן קצר', 'quiz', current_date + 7) returning id`, [U.G1])).id
  const ans = [1, 0, 2]
  for (let i = 0; i < 3; i++) {
    const it = (await s.one(`insert into public.assignment_items (assignment_id, position, prompt, options) values ($1, $2, $3, $4) returning id`,
      [a, i + 1, `שאלה ${i + 1}`, ['א', 'ב', 'ג']])).id
    await s.rows(`insert into public.assignment_answer_keys (item_id, answer_index) values ($1, $2)`, [it, ans[i]])
  }
  if (publish) await s.rows(`select public.publish_assignment($1)`, [a])
  return a
}
async function practice(s, publish = true) {
  await s.as(U.T1)
  const a = (await s.one(`insert into public.assignments (group_id, title, kind, player_path) values ($1, 'תרגול שברים', 'practice', 'fractions/') returning id`, [U.G1])).id
  if (publish) await s.rows(`select public.publish_assignment($1)`, [a])
  return a
}
const ev = (n, ok = true) => Array.from({ length: n }, () => ({ id: randomUUID(), kind: 'question', skill: 'pk_add', topic: 'frac', ok, ms: 4000 }))

describe('assignments: who creates, who sees', () => {
  it('only a teacher of the group creates assignments there', t(async s => {
    await practice(s, false)
    await s.as(U.T2)
    assert.match((await s.fails(`insert into public.assignments (group_id, title, kind, player_path) values ($1, 'x', 'practice', 'math/')`, [U.G1])).message, /row-level security/)
    for (const who of [U.S1, U.P1]) {
      await s.as(who)
      assert.match((await s.fails(`insert into public.assignments (group_id, title, kind, player_path) values ($1, 'x', 'practice', 'math/')`, [U.G1])).message, /row-level security|permission denied/)
    }
  }))
  it('a player path must be on the allow-list (no free URLs)', t(async s => {
    await s.as(U.T1)
    for (const p of ['https://evil.example/', 'javascript:alert(1)', '../math/', 'math']) {
      assert.match((await s.fails(`insert into public.assignments (group_id, title, kind, player_path) values ($1, 'x', 'practice', $2)`, [U.G1, p])).message, /check constraint/, p)
    }
  }))
  it('drafts are invisible to students and parents; published work only to the group\'s students and their parents', t(async s => {
    const a = await practice(s, false)
    for (const who of [U.S1, U.P1, U.S3, U.P2, U.T2]) { await s.as(who); assert.equal((await s.rows(`select id from public.assignments`)).length, 0, who) }
    await s.as(U.T1); await s.rows(`select public.publish_assignment($1)`, [a])
    for (const who of [U.S1, U.P1, U.T1]) { await s.as(who); assert.deepEqual((await s.rows(`select id from public.assignments`)).map(r => r.id), [a], who) }
    for (const who of [U.S3, U.P2, U.T2, U.S2]) { await s.as(who); assert.equal((await s.rows(`select id from public.assignments`)).length, 0, who) }
  }))
  it('published work is frozen: no edits of text, questions or answer keys', t(async s => {
    const a = await quiz(s)
    await s.as(U.T1)
    assert.equal(await s.count(`update public.assignments set title = 'אחר' where id = $1`, [a]), 0)
    assert.equal(await s.count(`update public.assignment_items set prompt = 'x' where assignment_id = $1`, [a]), 0)
    assert.equal(await s.count(`update public.assignment_answer_keys set answer_index = 0`), 0)
    assert.equal(await s.count(`delete from public.assignment_answer_keys`), 0)
    assert.equal((await s.rows(`select * from public.assignment_answer_keys`)).length, 3)   // still readable to the teacher
  }))
  it('a quiz is published only with a valid key for every question, numbered 1..n', t(async s => {
    await s.as(U.T1)
    const a = (await s.one(`insert into public.assignments (group_id, title, kind) values ($1, 'q', 'quiz') returning id`, [U.G1])).id
    assert.match((await s.fails(`select public.publish_assignment($1)`, [a])).message, /answer key/)
    const it1 = (await s.one(`insert into public.assignment_items (assignment_id, position, prompt, options) values ($1, 1, 'q1', $2) returning id`, [a, ['א', 'ב']])).id
    await s.rows(`insert into public.assignment_answer_keys values ($1, 1)`, [it1])
    const it3 = (await s.one(`insert into public.assignment_items (assignment_id, position, prompt, options) values ($1, 3, 'q3', $2) returning id`, [a, ['א', 'ב']])).id
    await s.rows(`insert into public.assignment_answer_keys values ($1, 0)`, [it3])
    assert.match((await s.fails(`select public.publish_assignment($1)`, [a])).message, /answer key/)    // gap: 1, 3
    await s.rows(`update public.assignment_items set position = 2 where id = $1`, [it3])
    await s.rows(`select public.publish_assignment($1)`, [a])
    await s.as(U.T2)
    assert.match((await s.fails(`select public.archive_assignment($1)`, [a])).message, /not your assignment/)
  }))
  it('students and parents see quiz questions but never the answer keys', t(async s => {
    await quiz(s)
    for (const who of [U.S1, U.P1]) {
      await s.as(who)
      assert.equal((await s.rows(`select prompt, options from public.assignment_items`)).length, 3, who)
      assert.equal((await s.rows(`select * from public.assignment_answer_keys`)).length, 0, who)
    }
  }))
  it('an archived assignment disappears for the student and cannot be worked on', t(async s => {
    const a = await practice(s)
    await s.as(U.T1); await s.rows(`select public.archive_assignment($1)`, [a])
    await s.as(U.S1)
    assert.equal((await s.rows(`select id from public.assignments`)).length, 0)
    assert.match((await s.fails(`select public.start_session($1)`, [a])).message, /not available/)
  }))
})

describe('practice telemetry (unverified)', () => {
  it('a student starts a session only on own published work; teachers and parents cannot act as students', t(async s => {
    const a = await practice(s)
    await s.as(U.S3)
    assert.match((await s.fails(`select public.start_session($1)`, [a])).message, /not available/)
    for (const who of [U.T1, U.P1]) { await s.as(who); assert.match((await s.fails(`select public.start_session($1)`, [a])).message, /students only/) }
    await s.as(U.S1)
    assert.ok((await s.one(`select public.start_session($1) as id`, [a])).id)
  }))
  it('events are idempotent: a resent batch adds nothing; counters are kept by the server', t(async s => {
    const a = await practice(s)
    await s.as(U.S1)
    const sid = (await s.one(`select public.start_session($1) as id`, [a])).id
    const batch = [...ev(3, true), ...ev(2, false)]
    assert.equal((await s.one(`select public.record_progress($1, $2) as n`, [sid, JSON.stringify(batch)])).n, 5)
    assert.equal((await s.one(`select public.record_progress($1, $2) as n`, [sid, JSON.stringify(batch)])).n, 0)
    await s.rows(`select public.record_progress($1, $2)`, [sid, JSON.stringify([{ id: randomUUID(), kind: 'round_done' }])])
    const st = await s.one(`select state, practice_questions, practice_first_try, verified_score from public.assignment_status where assignment_id = $1`, [a])
    assert.deepEqual(st, { state: 'practiced', practice_questions: 5, practice_first_try: 3, verified_score: null })
  }))
  it('nobody writes into someone else\'s session; bad batches are refused', t(async s => {
    const a = await practice(s)
    await s.as(U.S1)
    const sid = (await s.one(`select public.start_session($1) as id`, [a])).id
    await s.as(U.S3)
    assert.match((await s.fails(`select public.record_progress($1, $2)`, [sid, JSON.stringify(ev(1))])).message, /session not found/)
    await s.as(U.S1)
    assert.match((await s.fails(`select public.record_progress($1, $2)`, [sid, JSON.stringify(ev(51))])).message, /1–50/)
    assert.match((await s.fails(`select public.record_progress($1, $2)`, [sid, JSON.stringify([{ id: randomUUID(), kind: 'grade', ok: true }])])).message, /check constraint/)
  }))
  it('students have no direct writes to results, statuses or events', t(async s => {
    const a = await quiz(s)
    const p = await practice(s)
    await s.as(U.S1)
    await s.rows(`select public.start_session($1)`, [p])
    for (const q of [
      [`insert into public.quiz_attempts (assignment_id, student_id, attempt_no, answers, score, max_score) values ($1, $2, 1, '{1,0,2}', 3, 3)`, [a, U.S1]],
      [`update public.assignment_status set verified_score = 3, verified_max = 3 where assignment_id = $1`, [a]],
      [`insert into public.assignment_status (assignment_id, student_id, state, verified_score) values ($1, $2, 'completed', 99)`, [a, U.S1]],
      [`insert into public.progress_events (id, session_id, student_id, kind) select gen_random_uuid(), id, student_id, 'question' from public.learning_sessions`, []],
    ]) assert.match((await s.fails(q[0], q[1])).message, /permission denied/, q[0])
  }))
})

describe('verified results: server-graded quizzes', () => {
  it('the server grades against hidden keys; no score is accepted from the client', t(async s => {
    const a = await quiz(s)
    await s.as(U.S1)
    assert.deepEqual((await s.one(`select public.submit_quiz($1, '{1,0,0}') as r`, [a])).r, { score: 2, max: 3, attempt: 1, attempts_left: 2, late: false })
    assert.deepEqual((await s.one(`select verified_score, verified_max, state from public.assignment_status where assignment_id = $1`, [a])),
      { verified_score: 2, verified_max: 3, state: 'completed' })
  }))
  it('the best of at most 3 attempts counts; a 4th is refused; wrong length refused', t(async s => {
    const a = await quiz(s)
    await s.as(U.S1)
    assert.match((await s.fails(`select public.submit_quiz($1, '{1,0}')`, [a])).message, /answer every question/)
    await s.rows(`select public.submit_quiz($1, '{1,0,2}')`, [a])
    await s.rows(`select public.submit_quiz($1, '{0,0,0}')`, [a])
    await s.rows(`select public.submit_quiz($1, '{0,1,1}')`, [a])
    assert.match((await s.fails(`select public.submit_quiz($1, '{1,0,2}')`, [a])).message, /no attempts left/)
    assert.equal((await s.one(`select verified_score from public.assignment_status where assignment_id = $1`, [a])).verified_score, 3)
  }))
  it('a student of another group, a teacher or a parent cannot submit', t(async s => {
    const a = await quiz(s)
    await s.as(U.S3); assert.match((await s.fails(`select public.submit_quiz($1, '{1,0,2}')`, [a])).message, /not available/)
    await s.as(U.T1); assert.match((await s.fails(`select public.submit_quiz($1, '{1,0,2}')`, [a])).message, /students only/)
  }))
})

describe('account deletion', () => {
  it('an adult who created things (roles, children, groups, invitations, devices, assignments) can still be deleted', t(async s => {
    const a = await quiz(s)
    await s.asOwner()
    await s.rows(`update public.user_roles set granted_by = $1 where user_id = $2`, [U.P1, U.S1])
    await s.rows(`update public.students set created_by = $1 where id = $2`, [U.P1, U.S1])
    await s.rows(`insert into public.student_devices (student_id, token_hash, enrolled_by) values ($1, repeat('a', 64), $2)`, [U.S1, U.P1])
    await s.rows(`delete from auth.users where id = $1`, [U.P1])        // parent: roles granted, child created, device approved
    await s.rows(`delete from auth.users where id = $1`, [U.T1])        // teacher: group, invitations, assignment
    assert.equal((await s.one(`select count(*)::int n from public.groups where id = $1`, [U.G1])).n, 1)              // the group stays
    assert.equal((await s.one(`select created_by from public.assignments where id = $1`, [a])).created_by, null)
    assert.equal((await s.one(`select count(*)::int n from public.consents where id = $1`, [U.C_S1_G1])).n, 1)     // consent stays on record
  }))
})

describe('who sees learning data', () => {
  async function activity(s) {
    const a = await quiz(s)
    const p = await practice(s)
    await s.as(U.S1)
    const sid = (await s.one(`select public.start_session($1) as id`, [p])).id
    await s.rows(`select public.record_progress($1, $2)`, [sid, JSON.stringify(ev(2))])
    await s.rows(`select public.submit_quiz($1, '{1,0,2}')`, [a])
    const free = (await s.one(`select public.start_session(null) as id`)).id      // free practice, no assignment
    await s.rows(`select public.record_progress($1, $2)`, [free, JSON.stringify(ev(1))])
    return a
  }
  it('the group\'s teacher and the parent see it; other teachers and families do not', t(async s => {
    const a = await activity(s)
    for (const who of [U.T1, U.P1, U.S1]) {
      await s.as(who)
      assert.equal((await s.rows(`select * from public.assignment_status where assignment_id = $1`, [a])).length, 1, who)
      assert.equal((await s.rows(`select * from public.quiz_attempts`)).length, 1, who)
    }
    for (const who of [U.T2, U.P2, U.S3]) {
      await s.as(who)
      for (const tb of ['assignment_status', 'quiz_attempts', 'progress_events', 'learning_sessions']) assert.equal((await s.rows(`select * from public.${tb}`)).length, 0, `${who} ${tb}`)
    }
  }))
  it('free practice (no assignment) is the family\'s: the parent sees it, the teacher does not', t(async s => {
    await activity(s)
    await s.as(U.P1); assert.equal((await s.rows(`select * from public.learning_sessions where assignment_id is null`)).length, 1)
    await s.as(U.T1); assert.equal((await s.rows(`select * from public.learning_sessions where assignment_id is null`)).length, 0)
  }))
  it('revoking consent: the teacher loses the child\'s results at once, and the child the assignment', t(async s => {
    const a = await activity(s)
    await s.as(U.P1); await s.rows(`select public.revoke_consent($1)`, [U.C_S1_G1])
    await s.as(U.T1)
    for (const tb of ['assignment_status', 'quiz_attempts', 'progress_events']) assert.equal((await s.rows(`select * from public.${tb}`)).length, 0, tb)
    await s.as(U.S1)
    assert.match((await s.fails(`select public.start_session($1)`, [a])).message, /not available/)
    await s.as(U.P1)
    assert.equal((await s.rows(`select * from public.quiz_attempts`)).length, 1)    // the family keeps its own history
  }))
})
