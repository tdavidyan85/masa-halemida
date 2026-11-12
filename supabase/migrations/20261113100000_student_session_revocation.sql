-- Revoking a child's device ends the sessions that were opened on it – at once, on the server.
--
-- Before: a device was only checked at sign-in. A session opened on a device that a parent later revoked kept
-- working (and could be refreshed) until it expired.
-- Now:
--   * student-login binds every student session (the JWT's session_id) to the device it was opened on
--     (srv_bind_student_session, service role only). A session that is not bound is refused – fail closed.
--   * app.student_session_ok() is false for a student whose session is unbound or whose device was revoked.
--   * PostgREST runs app.check_request() before EVERY REST/RPC request (pgrst.db_pre_request) → HTTP 401.
--     A refreshed access token keeps the same session_id, so refreshing does not help either.
--   * The storage policies a student can use check the same function.
-- Adults are not affected (the function answers true for anyone who is not a student).

create table public.student_sessions (
  session_id uuid primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  device_id  uuid references public.student_devices (id) on delete cascade,   -- null: username + password sign-in
  created_at timestamptz not null default now()
);
create index student_sessions_device on public.student_sessions (device_id);
create index student_sessions_student on public.student_sessions (student_id);
alter table public.student_sessions enable row level security;          -- no policies: nobody but the server reads it
revoke all on public.student_sessions from anon, authenticated;

create function public.srv_bind_student_session(p_session uuid, p_student uuid, p_device_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare dev uuid; mode text;
begin
  select s.login_mode into mode from public.students s where s.id = p_student;
  if mode is null then raise exception 'student not found'; end if;
  if p_device_hash is not null then
    select d.id into dev from public.student_devices d
     where d.token_hash = p_device_hash and d.student_id = p_student and d.revoked_at is null;
    if dev is null then raise exception 'device not approved for this student' using errcode = '42501'; end if;
  elsif mode = 'pin' then
    raise exception 'a PIN sign-in needs an approved device' using errcode = '42501';
  end if;
  insert into public.student_sessions (session_id, student_id, device_id) values (p_session, p_student, dev);
end $$;
revoke all on function public.srv_bind_student_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.srv_bind_student_session(uuid, uuid, text) to service_role;

/** false only for a STUDENT whose current session is unbound, or bound to a revoked device */
create function app.student_session_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); sid text;
begin
  if uid is null or not exists (select 1 from public.students s where s.id = uid) then return true; end if;
  sid := auth.jwt() ->> 'session_id';
  if sid is null or sid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return exists (
    select 1 from public.student_sessions b
      left join public.student_devices d on d.id = b.device_id
     where b.session_id = sid::uuid and b.student_id = uid
       and (b.device_id is null or d.revoked_at is null));
end $$;
revoke all on function app.student_session_ok() from public;
grant execute on function app.student_session_ok() to anon, authenticated, service_role;

/** PostgREST pre-request hook: a revoked device's session gets 401 on every request */
create function app.check_request() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.student_session_ok() then
    raise sqlstate 'PT401' using message = 'session_revoked', hint = 'המכשיר הזה כבר לא מאושר. צריך להתחבר מחדש.';
  end if;
end $$;
revoke all on function app.check_request() from public;
grant usage on schema app to anon, service_role;        -- the hook runs for every role; anon may execute only these two
grant execute on function app.check_request() to anon, authenticated, service_role;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request to ''app.check_request''';
  end if;
end $$;
notify pgrst, 'reload config';

-- storage: the policies a student can pass also require a live session
alter policy avatars_read on storage.objects
  using (bucket_id = 'avatars' and app.student_session_ok() and app.can_see_avatar(app.object_owner(name)));
alter policy materials_read on storage.objects
  using (bucket_id = 'materials' and app.student_session_ok() and app.can_read_material(app.material_of_object(name)));
