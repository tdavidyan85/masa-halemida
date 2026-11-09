// RLS security tests – run against a throwaway LOCAL PostgreSQL (see db.mjs). Every test runs in a
// transaction that is rolled back. "fails" = the database refused; a silently-filtered UPDATE affects 0 rows.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, tx, U } from './db.mjs'

let db
before(async () => { db = await startDb() })
after(async () => { await db?.stop() })
const t = fn => () => tx(db.client, fn)
const DENIED = /permission denied|row-level security|42501|not your group|admins only|cannot|only|not found|parents only|requested/

describe('signed-out visitors (anon)', () => {
  it('cannot read any table', t(async s => {
    await s.as('anon')
    for (const tbl of ['profiles', 'user_roles', 'students', 'guardianships', 'groups', 'group_members', 'consents', 'invitations', 'audit_log', 'learning_materials']) {
      const e = await s.fails(`select * from public.${tbl}`)
      assert.match(e.message, /permission denied/, tbl)
    }
  }))
  it('cannot call any server function', t(async s => {
    await s.as('anon')
    assert.match((await s.fails(`select public.request_role('parent')`)).message, /permission denied/)
    assert.match((await s.fails(`select public.revoke_consent($1)`, [U.C_S1_G1])).message, /permission denied/)
  }))
})

describe('privilege escalation', () => {
  it('nobody writes user_roles directly – not even an admin', t(async s => {
    for (const who of [U.P1, U.T1, U.S1, U.A]) {
      await s.as(who)
      assert.match((await s.fails(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [who])).message, /permission denied/)
      assert.match((await s.fails(`update public.user_roles set status = 'active'`)).message, /permission denied/)
    }
  }))
  it('admin and student roles cannot be requested', t(async s => {
    await s.as(U.P1)
    assert.match((await s.fails(`select public.request_role('admin')`)).message, /cannot be requested/)
    assert.match((await s.fails(`select public.request_role('student')`)).message, /cannot be requested/)
  }))
  it('a requested teacher role stays pending and gives no teacher powers until an admin approves', t(async s => {
    await s.as(U.P1)
    assert.equal((await s.one(`select public.request_role('teacher') as st`)).st, 'pending')
    assert.match((await s.fails(`insert into public.groups (name, subject, grade) values ('x', 'math', 'ב')`)).message, /row-level security/)
    await s.as(U.A)
    await s.rows(`select public.admin_set_role($1, 'teacher', 'active')`, [U.P1])
    await s.as(U.P1)
    assert.equal((await s.rows(`insert into public.groups (name, subject, grade) values ('חדשה', 'math', 'ב') returning id`)).length, 1)
  }))
  it('a student cannot gain another role, even from an admin', t(async s => {
    await s.as(U.S1)
    assert.match((await s.fails(`select public.request_role('parent')`)).message, /student account cannot hold another role/)
    await s.as(U.A)
    assert.match((await s.fails(`select public.admin_set_role($1, 'teacher', 'active')`, [U.S1])).message, /student account cannot hold another role/)
  }))
  it('only admins call admin functions, and an admin cannot change their own roles', t(async s => {
    await s.as(U.T1)
    assert.match((await s.fails(`select public.admin_set_role($1, 'admin', 'active')`, [U.T1])).message, /admins only/)
    assert.match((await s.fails(`select public.admin_set_profile_status($1, 'suspended')`, [U.T2])).message, /admins only/)
    await s.as(U.A)
    assert.match((await s.fails(`select public.admin_set_role($1, 'admin', 'revoked')`, [U.A])).message, /your own roles/)
  }))
  it('a role in the sign-up metadata is ignored', t(async s => {
    await s.asOwner()
    await s.rows(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-a000-0000000000ff', 'x@test.local', '{"full_name":"חדש","role":"admin"}')`)
    assert.equal((await s.rows(`select * from public.user_roles where user_id = '00000000-0000-4000-a000-0000000000ff'`)).length, 0)
    assert.equal((await s.one(`select full_name from public.profiles where id = '00000000-0000-4000-a000-0000000000ff'`)).full_name, 'חדש')
  }))
  it('nobody changes their own profile status (e.g. un-suspends themselves)', t(async s => {
    await s.as(U.T1)
    assert.match((await s.fails(`update public.profiles set status = 'active' where id = $1`, [U.T1])).message, /permission denied/)
  }))
  it('a suspended teacher loses every teacher power at once', t(async s => {
    await s.as(U.A)
    await s.rows(`select public.admin_set_profile_status($1, 'suspended')`, [U.T1])
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students`)).length, 0)
    assert.equal((await s.rows(`select * from public.groups`)).length, 0)
  }))
  it('the PIN/lockout table is closed to everyone, admins included', t(async s => {
    for (const who of [U.A, U.P1, U.S1]) {
      await s.as(who)
      assert.match((await s.fails(`select * from public.student_credentials`)).message, /permission denied/)
    }
  }))
})

describe('students: learn and look, change nothing', () => {
  it('cannot edit their own name or picture (0 rows changed)', t(async s => {
    await s.as(U.S1)
    assert.equal(await s.count(`update public.profiles set full_name = 'שם אחר' where id = $1`, [U.S1]), 0)
    assert.equal(await s.count(`update public.profiles set avatar_path = $2 where id = $1`, [U.S1, `${U.S1}/a.png`]), 0)
    await s.asOwner()
    assert.equal((await s.one(`select full_name from public.profiles where id = $1`, [U.S1])).full_name, 'תלמיד אחד')
  }))
  it('cannot change their grade, groups, memberships or consents', t(async s => {
    await s.as(U.S1)
    assert.equal(await s.count(`update public.students set grade = 'ו' where id = $1`, [U.S1]), 0)
    assert.match((await s.fails(`insert into public.groups (name, subject, grade) values ('x', 'math', 'ב')`)).message, /row-level security/)
    assert.equal(await s.count(`update public.groups set name = 'x'`), 0)
    assert.match((await s.fails(`update public.group_members set status = 'removed' where student_id = $1`, [U.S1])).message, /permission denied/)
    assert.match((await s.fails(`insert into public.consents (student_id, guardian_id, scope, text_version) values ($1, $1, 'photo', 'v')`, [U.S1])).message, /permission denied/)
    assert.match((await s.fails(`select public.revoke_consent($1)`, [U.C_S1_G1])).message, /not found/)
  }))
  it('cannot upload learning material', t(async s => {
    await s.as(U.S1)
    assert.match((await s.fails(`insert into public.learning_materials (title) values ('שיעורי בית')`)).message, /row-level security/)
  }))
  it('cannot upload a profile picture, even their own', t(async s => {
    await s.as(U.S1)
    assert.match((await s.fails(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U.S1}/me.png`])).message, /row-level security/)
  }))
  it('sees only themselves and their own groups, never another student', t(async s => {
    await s.as(U.S1)
    assert.deepEqual((await s.rows(`select id from public.students`)).map(r => r.id), [U.S1])
    assert.deepEqual((await s.rows(`select id from public.groups`)).map(r => r.id), [U.G1])
    const seen = (await s.rows(`select id from public.profiles`)).map(r => r.id).sort()
    assert.deepEqual(seen, [U.T1, U.P1, U.S1].sort())      // self, own teacher, own parent
  }))
})

describe('teachers: only students in their authorised groups', () => {
  it('each teacher sees only the students of her own groups', t(async s => {
    await s.as(U.T1)
    assert.deepEqual((await s.rows(`select id from public.students`)).map(r => r.id), [U.S1])
    await s.as(U.T2)
    assert.deepEqual((await s.rows(`select id from public.students`)).map(r => r.id), [U.S3])
  }))
  it('a teacher cannot see a student outside her groups, by any route', t(async s => {
    await s.as(U.T1)
    for (const id of [U.S2, U.S3, U.S4]) {
      assert.equal((await s.rows(`select * from public.profiles where id = $1`, [id])).length, 0, `profile ${id}`)
      assert.equal((await s.rows(`select id from public.students where id = $1`, [id])).length, 0, `student ${id}`)
      assert.equal((await s.rows(`select * from public.group_members where student_id = $1`, [id])).length, 0, `member ${id}`)
      assert.equal((await s.rows(`select * from public.consents where student_id = $1`, [id])).length, 0, `consent ${id}`)
    }
    assert.equal((await s.rows(`select * from public.groups where id = $1`, [U.G2])).length, 0)
  }))
  it('a teacher never sees birth dates or usernames', t(async s => {
    await s.as(U.T1)
    assert.match((await s.fails(`select birth_date from public.students`)).message, /permission denied/)
    assert.match((await s.fails(`select username from public.students`)).message, /permission denied/)
  }))
  it('a teacher cannot change or join another teacher\'s group', t(async s => {
    await s.as(U.T1)
    assert.equal(await s.count(`update public.groups set name = 'x' where id = $1`, [U.G2]), 0)
    assert.match((await s.fails(`insert into public.group_teachers (group_id, teacher_id, role) values ($1, $2, 'co')`, [U.G2, U.T1])).message, /row-level security/)
    assert.match((await s.fails(`select public.create_invitation($1, 'p1@test.local', 'x')`, [U.G2])).message, /not your group/)
  }))
  it('the owner adds a co-teacher, who then sees that group\'s students only', t(async s => {
    await s.as(U.T1)
    await s.rows(`insert into public.group_teachers (group_id, teacher_id, role) values ($1, $2, 'co')`, [U.G1, U.T2])
    await s.as(U.T2)
    assert.deepEqual((await s.rows(`select id from public.students order by id`)).map(r => r.id), [U.S1, U.S3])
    assert.match((await s.fails(`insert into public.group_teachers (group_id, teacher_id, role) values ($1, $2, 'owner')`, [U.G1, U.T2])).message, /row-level security/)
  }))
  it('a pending teacher cannot be added as co-teacher and sees nothing', t(async s => {
    await s.as(U.T1)
    assert.match((await s.fails(`insert into public.group_teachers (group_id, teacher_id, role) values ($1, $2, 'co')`, [U.G1, U.T3])).message, /row-level security/)
    await s.as(U.T3)
    assert.equal((await s.rows(`select id from public.students`)).length, 0)
  }))
  it('a teacher may remove a student from her group, but never add one back', t(async s => {
    await s.as(U.T2)
    assert.match((await s.fails(`select public.remove_member($1, $2)`, [U.G1, U.S1])).message, /not your group/)
    await s.as(U.T1)
    await s.rows(`select public.remove_member($1, $2)`, [U.G1, U.S1])
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S1])).length, 0)
    await s.asOwner()
    assert.equal((await s.one(`select status from public.group_members where student_id = $1`, [U.S1])).status, 'removed')
    await s.as(U.T1)
    assert.match((await s.fails(`update public.group_members set status = 'active' where student_id = $1`, [U.S1])).message, /permission denied/)
    assert.match((await s.fails(`insert into public.group_members (group_id, student_id) values ($1, $2)`, [U.G1, U.S2])).message, /permission denied/)
  }))
  it('select * on students is refused: hidden columns cannot be pulled in by accident', t(async s => {
    await s.as(U.P1)
    assert.match((await s.fails(`select * from public.students`)).message, /permission denied/)
    assert.equal((await s.rows(`select id, grade, login_mode from public.students`)).length, 2)
  }))
  it('teachers cannot read the audit log or other teachers\' materials', t(async s => {
    await s.as(U.T2)
    await s.rows(`insert into public.learning_materials (title) values ('דף של מורה 2')`)
    await s.as(U.T1)
    assert.equal((await s.rows(`select * from public.audit_log`)).length, 0)
    assert.equal((await s.rows(`select * from public.learning_materials`)).length, 0)
  }))
})

describe('parents: only their own children; revoking consent ends access', () => {
  it('a parent sees all and only their own children', t(async s => {
    await s.as(U.P1)
    assert.deepEqual((await s.rows(`select id from public.students order by id`)).map(r => r.id), [U.S1, U.S2])
    assert.equal((await s.rows(`select * from public.profiles where id = $1`, [U.S3])).length, 0)
    assert.equal((await s.rows(`select * from public.group_members where student_id = $1`, [U.S3])).length, 0)
  }))
  it('a parent updates their child, not someone else\'s', t(async s => {
    await s.as(U.P1)
    assert.equal(await s.count(`update public.students set grade = 'ג' where id = $1`, [U.S1]), 1)
    assert.equal(await s.count(`update public.students set grade = 'ג' where id = $1`, [U.S3]), 0)
    assert.equal(await s.count(`update public.profiles set full_name = 'שם' where id = $1`, [U.S3]), 0)
  }))
  it('revoking the group consent ends the teacher\'s access immediately', t(async s => {
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S1])).length, 1)
    await s.as(U.P1)
    await s.rows(`select public.revoke_consent($1)`, [U.C_S1_G1])
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S1])).length, 0)
    assert.equal((await s.rows(`select * from public.profiles where id = $1`, [U.S1])).length, 0)
    assert.equal((await s.rows(`select * from public.group_members where student_id = $1`, [U.S1])).length, 0)
    await s.asOwner()
    assert.equal((await s.one(`select status from public.group_members where student_id = $1`, [U.S1])).status, 'removed')
  }))
  it('access ends with revocation even if the membership row were still active', t(async s => {
    await s.asOwner()
    await s.rows(`update public.consents set revoked_at = now() where id = $1`, [U.C_S1_G1])
    await s.rows(`update public.group_members set status = 'active' where student_id = $1`, [U.S1])   // simulate a stale row
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S1])).length, 0)
  }))
  it('a parent cannot revoke another family\'s consent', t(async s => {
    await s.as(U.P2)
    assert.match((await s.fails(`select public.revoke_consent($1)`, [U.C_S1_G1])).message, /not found/)
  }))
  it('a parent cannot write consents or memberships directly', t(async s => {
    await s.as(U.P1)
    assert.match((await s.fails(`insert into public.consents (student_id, guardian_id, scope, group_id, text_version) values ($1, $2, 'group', $3, 'v')`, [U.S2, U.P1, U.G1])).message, /permission denied/)
    assert.match((await s.fails(`insert into public.group_members (group_id, student_id) values ($1, $2)`, [U.G1, U.S2])).message, /permission denied/)
  }))
})

describe('invitations and verified consent', () => {
  it('only the addressed parent sees the invitation; the e-mail hash is never readable', t(async s => {
    await s.as(U.P2)
    assert.deepEqual((await s.rows(`select id from public.invitations`)).map(r => r.id), [U.INV_P2])   // the expired one is hidden
    await s.as(U.P1)
    assert.equal((await s.rows(`select id from public.invitations`)).length, 0)
    await s.as(U.T1)
    assert.match((await s.fails(`select contact_hash from public.invitations`)).message, /permission denied/)
  }))
  it('a parent cannot answer an invitation sent to someone else', t(async s => {
    await s.as(U.P1)
    assert.match((await s.fails(`select public.respond_invitation($1, true, $2)`, [U.INV_P2, U.S1])).message, /not found/)
  }))
  it('a parent can attach only their own child', t(async s => {
    await s.as(U.P2)
    assert.match((await s.fails(`select public.respond_invitation($1, true, $2)`, [U.INV_P2, U.S1])).message, /verified parent of this child/)
  }))
  it('approving creates the consent and the membership; the teacher then sees the child; only once', t(async s => {
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S3])).length, 0)
    await s.as(U.P2)
    const cid = (await s.one(`select public.respond_invitation($1, true, $2) as c`, [U.INV_P2, U.S3])).c
    assert.ok(cid)
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S3])).length, 1)
    await s.as(U.P2)
    assert.match((await s.fails(`select public.respond_invitation($1, true, $2)`, [U.INV_P2, U.S3])).message, /already answered/)
  }))
  it('an expired invitation cannot be approved', t(async s => {
    await s.as(U.P2)
    assert.match((await s.fails(`select public.respond_invitation($1, true, $2)`, [U.INV_P2_EXPIRED, U.S3])).message, /expired/)
  }))
  it('an UNVERIFIED parent cannot approve', t(async s => {
    await s.as(U.P3)
    assert.match((await s.fails(`select public.respond_invitation($1, true, $2)`, [U.INV_P3, U.S4])).message, /verified parent/)
  }))
  it('a parent with an unconfirmed e-mail cannot see or answer invitations', t(async s => {
    await s.asOwner()
    await s.rows(`update auth.users set email_confirmed_at = null where id = $1`, [U.P2])
    await s.as(U.P2)
    assert.equal((await s.rows(`select id from public.invitations`)).length, 0)
    assert.match((await s.fails(`select public.respond_invitation($1, true, $2)`, [U.INV_P2, U.S3])).message, /not found/)
  }))
  it('declining adds nobody', t(async s => {
    await s.as(U.P2)
    await s.rows(`select public.respond_invitation($1, false)`, [U.INV_P2])
    await s.as(U.T1)
    assert.equal((await s.rows(`select id from public.students where id = $1`, [U.S3])).length, 0)
  }))
})

describe('audit log', () => {
  it('records role, consent and membership changes – without names', t(async s => {
    await s.as(U.P1)
    await s.rows(`select public.revoke_consent($1)`, [U.C_S1_G1])
    await s.as(U.A)
    const log = await s.rows(`select actor, action, table_name, details from public.audit_log where actor = $1 order by id`, [U.P1])
    assert.deepEqual(log.map(r => `${r.action} ${r.table_name}`), ['UPDATE consents', 'UPDATE group_members'])
    assert.ok(!JSON.stringify(await s.rows(`select details from public.audit_log`)).includes('תלמיד'))
  }))
  it('is append-only, even for the database owner', t(async s => {
    await s.as(U.A)
    assert.match((await s.fails(`delete from public.audit_log`)).message, /permission denied/)
    await s.asOwner()
    assert.match((await s.fails(`delete from public.audit_log`)).message, /append-only/)
    assert.match((await s.fails(`update public.audit_log set action = 'x'`)).message, /append-only/)
  }))
})

describe('private profile pictures', () => {
  const objs = `insert into storage.objects (bucket_id, name) values ('avatars', $1)`
  it('a parent uploads a child\'s picture only with photo consent, and only a verified parent may give it', t(async s => {
    await s.as(U.P1)
    assert.match((await s.fails(objs, [`${U.S1}/face.webp`])).message, /row-level security/)
    await s.rows(`select public.grant_consent($1, 'photo', 'photo-v1')`, [U.S1])
    await s.rows(objs, [`${U.S1}/face.webp`])
    await s.as(U.P3)
    assert.match((await s.fails(`select public.grant_consent($1, 'photo', 'photo-v1')`, [U.S4])).message, /verified parent/)
  }))
  it('the child\'s teacher sees the picture only with photo consent; other teachers never', t(async s => {
    await s.asOwner()
    await s.rows(objs, [`${U.S1}/face.webp`])
    await s.as(U.T1)
    assert.equal((await s.rows(`select * from storage.objects`)).length, 0)
    await s.as(U.P1)
    await s.rows(`select public.grant_consent($1, 'photo', 'photo-v1')`, [U.S1])
    await s.as(U.T1)
    assert.equal((await s.rows(`select * from storage.objects`)).length, 1)
    await s.as(U.T2)
    assert.equal((await s.rows(`select * from storage.objects`)).length, 0)
  }))
  it('adults manage only their own picture; odd paths are refused', t(async s => {
    await s.as(U.T1)
    await s.rows(objs, [`${U.T1}/me.png`])
    assert.match((await s.fails(objs, [`${U.T2}/me.png`])).message, /row-level security/)
    assert.match((await s.fails(objs, ['../etc/passwd'])).message, /row-level security/)
    assert.match((await s.fails(objs, [`${U.T1}/../x.png`])).message, /row-level security/)
  }))
})
