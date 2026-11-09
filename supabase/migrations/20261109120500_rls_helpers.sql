-- Helper predicates used by the RLS policies. SECURITY DEFINER so a policy can look at other tables
-- without recursing through their own policies; every function only answers true/false about the
-- CALLER (auth.uid()), never returns data. search_path is empty so nothing can be shadowed.

create function app.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
$$;

create function app.user_has_role(p_user uuid, p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = p_user and r.role = p_role and r.status = 'active' and p.status = 'active')
$$;

create function app.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_has_role((select auth.uid()), p_role)
$$;

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.has_role('admin') $$;

create function app.is_guardian_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('parent') and exists (
    select 1 from public.guardianships g
    where g.parent_id = (select auth.uid()) and g.student_id = p_student and g.status = 'active')
$$;

-- a verified guardian may give consent; an unverified one may only look
create function app.is_verified_guardian_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('parent') and exists (
    select 1 from public.guardianships g
    where g.parent_id = (select auth.uid()) and g.student_id = p_student and g.status = 'active' and g.verified_at is not null)
$$;

create function app.consent_active(p_student uuid, p_scope text, p_group uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.consents c
    where c.student_id = p_student and c.scope = p_scope and c.revoked_at is null
      and (p_group is null or c.group_id = p_group))
$$;

create function app.teaches_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('teacher') and exists (
    select 1 from public.group_teachers t where t.group_id = p_group and t.teacher_id = (select auth.uid()))
$$;

create function app.owns_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('teacher') and exists (
    select 1 from public.group_teachers t where t.group_id = p_group and t.teacher_id = (select auth.uid()) and t.role = 'owner')
$$;

-- THE teacher rule: a teacher sees a student only through a group she teaches, where the student is an
-- active member AND the parent's consent for that very group is in force. Revoking consent ends it at once.
create function app.teaches_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('teacher') and exists (
    select 1 from public.group_members m
    join public.group_teachers t on t.group_id = m.group_id
    where m.student_id = p_student and m.status = 'active' and t.teacher_id = (select auth.uid())
      and app.consent_active(p_student, 'group', m.group_id))
$$;

create function app.member_of_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('student') and exists (
    select 1 from public.group_members m
    where m.group_id = p_group and m.student_id = (select auth.uid()) and m.status = 'active')
$$;

create function app.child_in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('parent') and exists (
    select 1 from public.group_members m
    join public.guardianships g on g.student_id = m.student_id
    where m.group_id = p_group and m.status = 'active' and g.parent_id = (select auth.uid()) and g.status = 'active')
$$;

create function app.can_see_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin() or app.teaches_group(p_group) or app.member_of_group(p_group) or app.child_in_group(p_group)
$$;

create function app.email_hash(p_email text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
$$;

-- hash of the caller's CONFIRMED e-mail (null if not confirmed)
create function app.my_email_hash() returns text
language sql stable security definer set search_path = '' as $$
  select app.email_hash(u.email) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null
$$;

create function app.can_see_profile(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_target = (select auth.uid())
      or app.is_admin()
      or app.is_guardian_of(p_target)
      or app.teaches_student(p_target)
      -- the teachers of groups I can see (a student's or a child's teachers, a co-teacher)
      or exists (select 1 from public.group_teachers t where t.teacher_id = p_target and app.can_see_group(t.group_id))
      -- a teacher who invited me (parent) and is waiting for my answer
      or (app.has_role('parent') and exists (
            select 1 from public.invitations i
            where i.invited_by = p_target and i.status = 'pending' and i.expires_at > now()
              and i.contact_hash = app.my_email_hash()))
      -- a student sees their own parents
      or exists (select 1 from public.guardianships g where g.student_id = (select auth.uid()) and g.parent_id = p_target and g.status = 'active')
$$;

-- avatars live at "<owner id>/<file>"; anything else has no owner
create function app.object_owner(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

create function app.can_see_avatar(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_owner is null then false
    when p_owner = (select auth.uid()) or app.is_admin() or app.is_guardian_of(p_owner) then true
    -- a child's picture: their teachers only with the parent's photo consent
    when exists (select 1 from public.students s where s.id = p_owner)
      then app.teaches_student(p_owner) and app.consent_active(p_owner, 'photo')
    else app.can_see_profile(p_owner)
  end
$$;

create function app.can_manage_avatar(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_owner is null then false
    -- an adult manages their own picture; a student never uploads (decision: students change nothing)
    when p_owner = (select auth.uid()) then app.is_active() and not app.has_role('student')
    -- a parent manages a child's picture, only with an active photo consent
    else app.is_guardian_of(p_owner) and app.consent_active(p_owner, 'photo')
  end
$$;

revoke all on all functions in schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
