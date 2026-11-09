-- FICTIONAL test data (no real people). Loaded as the database owner, after the migrations.
--   A  admin                       T1 teacher, owns g1         T2 teacher, owns g2      T3 teacher waiting for approval
--   P1 parent of S1, S2 (verified) P2 parent of S3 (verified)  P3 parent of S4 (NOT verified)
--   S1 in g1 (consent)             S2 in no group               S3 in g2 (consent)       S4 in no group
--   invitations: T1 → P2 for g1 (pending) · T1 → P2 for g1 (expired) · T1 → P3 for g1 (pending)
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-a000-000000000001', 'admin@test.local', now(), '{"full_name":"מנהלת בדיקה"}'),
  ('00000000-0000-4000-a000-000000000011', 't1@test.local',    now(), '{"full_name":"מורה אחת"}'),
  ('00000000-0000-4000-a000-000000000012', 't2@test.local',    now(), '{"full_name":"מורה שתיים"}'),
  ('00000000-0000-4000-a000-000000000013', 't3@test.local',    now(), '{"full_name":"מורה ממתינה"}'),
  ('00000000-0000-4000-a000-000000000021', 'p1@test.local',    now(), '{"full_name":"הורה אחד"}'),
  ('00000000-0000-4000-a000-000000000022', 'p2@test.local',    now(), '{"full_name":"הורה שתיים"}'),
  ('00000000-0000-4000-a000-000000000023', 'p3@test.local',    now(), '{"full_name":"הורה לא מאומת"}'),
  ('00000000-0000-4000-a000-000000000031', 's1@students.invalid', now(), '{"full_name":"תלמיד אחד"}'),
  ('00000000-0000-4000-a000-000000000032', 's2@students.invalid', now(), '{"full_name":"תלמידה שתיים"}'),
  ('00000000-0000-4000-a000-000000000033', 's3@students.invalid', now(), '{"full_name":"תלמיד שלוש"}'),
  ('00000000-0000-4000-a000-000000000034', 's4@students.invalid', now(), '{"full_name":"תלמידה ארבע"}');

insert into public.user_roles (user_id, role, status) values
  ('00000000-0000-4000-a000-000000000001', 'admin', 'active'),
  ('00000000-0000-4000-a000-000000000011', 'teacher', 'active'),
  ('00000000-0000-4000-a000-000000000012', 'teacher', 'active'),
  ('00000000-0000-4000-a000-000000000013', 'teacher', 'pending'),
  ('00000000-0000-4000-a000-000000000021', 'parent', 'active'),
  ('00000000-0000-4000-a000-000000000022', 'parent', 'active'),
  ('00000000-0000-4000-a000-000000000023', 'parent', 'active'),
  ('00000000-0000-4000-a000-000000000031', 'student', 'active'),
  ('00000000-0000-4000-a000-000000000032', 'student', 'active'),
  ('00000000-0000-4000-a000-000000000033', 'student', 'active'),
  ('00000000-0000-4000-a000-000000000034', 'student', 'active');

insert into public.students (id, birth_date, grade, login_mode, username) values
  ('00000000-0000-4000-a000-000000000031', '2018-03-01', 'ב', 'pin', null),
  ('00000000-0000-4000-a000-000000000032', '2015-05-02', 'ה', 'password', 'student.two'),
  ('00000000-0000-4000-a000-000000000033', '2016-07-03', 'ד', 'password', 'student.three'),
  ('00000000-0000-4000-a000-000000000034', '2020-09-04', 'גן', 'pin', null);

insert into public.guardianships (parent_id, student_id, relation, status, verified_at) values
  ('00000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000031', 'אמא', 'active', now()),
  ('00000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000032', 'אמא', 'active', now()),
  ('00000000-0000-4000-a000-000000000022', '00000000-0000-4000-a000-000000000033', 'אבא', 'active', now()),
  ('00000000-0000-4000-a000-000000000023', '00000000-0000-4000-a000-000000000034', 'אמא', 'active', null);

insert into public.groups (id, name, subject, grade, created_by) values
  ('00000000-0000-4000-b000-000000000101', 'קבוצה אחת', 'math', 'ב', '00000000-0000-4000-a000-000000000011'),
  ('00000000-0000-4000-b000-000000000102', 'קבוצה שתיים', 'english', 'ד', '00000000-0000-4000-a000-000000000012');

insert into public.consents (id, student_id, guardian_id, scope, group_id, text_version) values
  ('00000000-0000-4000-c000-000000000201', '00000000-0000-4000-a000-000000000031', '00000000-0000-4000-a000-000000000021', 'group', '00000000-0000-4000-b000-000000000101', 'group-v1'),
  ('00000000-0000-4000-c000-000000000202', '00000000-0000-4000-a000-000000000033', '00000000-0000-4000-a000-000000000022', 'group', '00000000-0000-4000-b000-000000000102', 'group-v1');

insert into public.group_members (group_id, student_id, status, consent_id) values
  ('00000000-0000-4000-b000-000000000101', '00000000-0000-4000-a000-000000000031', 'active', '00000000-0000-4000-c000-000000000201'),
  ('00000000-0000-4000-b000-000000000102', '00000000-0000-4000-a000-000000000033', 'active', '00000000-0000-4000-c000-000000000202');

insert into public.invitations (id, group_id, invited_by, contact_hash, child_hint, status, expires_at) values
  ('00000000-0000-4000-d000-000000000301', '00000000-0000-4000-b000-000000000101', '00000000-0000-4000-a000-000000000011', app.email_hash('p2@test.local'), 'שלוש', 'pending', now() + interval '7 days'),
  ('00000000-0000-4000-d000-000000000302', '00000000-0000-4000-b000-000000000101', '00000000-0000-4000-a000-000000000011', app.email_hash('P2@Test.local '), 'שלוש', 'pending', now() - interval '1 day'),
  ('00000000-0000-4000-d000-000000000303', '00000000-0000-4000-b000-000000000101', '00000000-0000-4000-a000-000000000011', app.email_hash('p3@test.local'), 'ארבע', 'pending', now() + interval '7 days');

-- P1 and P2 confirmed their phone (Supabase Auth OTP) → verified parents. P3 did not.
update auth.users set phone = '+972500000001', phone_confirmed_at = now() where id = '00000000-0000-4000-a000-000000000021';
update auth.users set phone = '+972500000002', phone_confirmed_at = now() where id = '00000000-0000-4000-a000-000000000022';
