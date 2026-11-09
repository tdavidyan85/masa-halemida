-- Server-side operations. Each one is SECURITY DEFINER and checks the caller itself, because it writes to
-- tables the caller cannot write directly. They are callable only by signed-in users (not anon).

-- An adult asks for a role. Parent: granted at once. Teacher: waits for an admin. Admin/student: never.
create function public.request_role(p_role public.app_role) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); st text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_role not in ('parent', 'teacher') then raise exception 'this role cannot be requested' using errcode = '42501'; end if;
  st := case p_role when 'parent' then 'active' else 'pending' end;
  insert into public.user_roles (user_id, role, status) values (uid, p_role, st)
  on conflict (user_id, role) do nothing;
  return (select r.status from public.user_roles r where r.user_id = uid and r.role = p_role);
end $$;

-- Admin: grant / approve / revoke a role. An admin cannot change their own roles (no lock-out, no self-grant).
create function public.admin_set_role(p_user uuid, p_role public.app_role, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own roles' using errcode = '42501'; end if;
  if p_status not in ('pending', 'active', 'revoked') then raise exception 'bad status'; end if;
  if p_role = 'student' then raise exception 'student accounts are created by the server' using errcode = '42501'; end if;
  insert into public.user_roles (user_id, role, status, granted_by) values (p_user, p_role, p_status, auth.uid())
  on conflict (user_id, role) do update set status = excluded.status, granted_by = excluded.granted_by;
end $$;

create function public.admin_set_profile_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot suspend yourself' using errcode = '42501'; end if;
  update public.profiles set status = p_status where id = p_user;
end $$;

-- Teacher invites a parent (by e-mail) into one of her groups. Only the hash of the address is stored.
create function public.create_invitation(p_group uuid, p_parent_email text, p_child_hint text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv uuid;
begin
  if not app.teaches_group(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  if exists (select 1 from public.groups g where g.id = p_group and g.archived_at is not null) then
    raise exception 'the group is archived'; end if;
  if p_parent_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad e-mail address'; end if;
  insert into public.invitations (group_id, invited_by, contact_hash, child_hint)
  values (p_group, auth.uid(), app.email_hash(p_parent_email), nullif(btrim(left(p_child_hint, 40)), ''))
  returning id into inv;
  return inv;
end $$;

-- The invited parent answers. Approving needs: the invitation is addressed to the caller's CONFIRMED
-- e-mail, is pending and not expired, and the caller is a VERIFIED guardian of the chosen child.
-- Creates the group consent and the membership in one step.
create function public.respond_invitation(p_invitation uuid, p_accept boolean, p_student uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations; cid uuid;
begin
  if not app.has_role('parent') then raise exception 'parents only' using errcode = '42501'; end if;
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or inv.contact_hash is distinct from app.my_email_hash() then
    raise exception 'invitation not found' using errcode = '42501';     -- same answer whether it exists or not
  end if;
  if inv.status <> 'pending' then raise exception 'the invitation was already answered'; end if;
  if inv.expires_at <= now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'the invitation has expired';
  end if;
  if not p_accept then
    update public.invitations set status = 'declined', responded_at = now() where id = inv.id;
    return null;
  end if;
  if p_student is null or not app.is_verified_guardian_of(p_student) then
    raise exception 'only a verified parent of this child can approve' using errcode = '42501';
  end if;
  select id into cid from public.consents
  where student_id = p_student and scope = 'group' and group_id = inv.group_id and revoked_at is null;
  if cid is null then
    insert into public.consents (student_id, guardian_id, scope, group_id, text_version)
    values (p_student, auth.uid(), 'group', inv.group_id, 'group-v1') returning id into cid;
  end if;
  insert into public.group_members (group_id, student_id, status, consent_id)
  values (inv.group_id, p_student, 'active', cid)
  on conflict (group_id, student_id) do update set status = 'active', consent_id = excluded.consent_id, removed_at = null;
  update public.invitations set status = 'accepted', responded_at = now(), accepted_student_id = p_student where id = inv.id;
  return cid;
end $$;

-- A teacher of the group removes a student. Re-adding always needs the parent again (a new invitation).
create function public.remove_member(p_group uuid, p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.teaches_group(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  update public.group_members set status = 'removed'
  where group_id = p_group and student_id = p_student and status = 'active';
  if not found then raise exception 'the student is not in this group'; end if;
end $$;

-- A verified parent gives an extra consent (profile picture, AI processing of their uploads, voice).
create function public.grant_consent(p_student uuid, p_scope text, p_text_version text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if p_scope not in ('photo', 'ai_material', 'voice') then raise exception 'use an invitation for group consent'; end if;
  if not app.is_verified_guardian_of(p_student) then raise exception 'only a verified parent of this child' using errcode = '42501'; end if;
  select id into cid from public.consents where student_id = p_student and scope = p_scope and revoked_at is null;
  if cid is null then
    insert into public.consents (student_id, guardian_id, scope, text_version)
    values (p_student, auth.uid(), p_scope, p_text_version) returning id into cid;
  end if;
  return cid;
end $$;

-- Any active guardian may withdraw a consent at any time; access ends immediately.
create function public.revoke_consent(p_consent uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  select student_id into s from public.consents where id = p_consent and revoked_at is null;
  if s is null or not app.is_guardian_of(s) then raise exception 'consent not found' using errcode = '42501'; end if;
  update public.consents set revoked_at = now(), revoked_by = auth.uid() where id = p_consent;
end $$;

revoke all on function public.request_role(public.app_role), public.admin_set_role(uuid, public.app_role, text),
  public.admin_set_profile_status(uuid, text), public.create_invitation(uuid, text, text),
  public.respond_invitation(uuid, boolean, uuid), public.remove_member(uuid, uuid), public.grant_consent(uuid, text, text), public.revoke_consent(uuid)
  from public, anon;
grant execute on function public.request_role(public.app_role), public.admin_set_role(uuid, public.app_role, text),
  public.admin_set_profile_status(uuid, text), public.create_invitation(uuid, text, text),
  public.respond_invitation(uuid, boolean, uuid), public.remove_member(uuid, uuid), public.grant_consent(uuid, text, text), public.revoke_consent(uuid)
  to authenticated;
