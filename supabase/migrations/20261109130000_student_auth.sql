-- Student accounts and student sign-in support.
--
-- How a student signs in (no home-made tokens): a student's Supabase Auth user has a random password
-- nobody knows, so Supabase Auth cannot be called directly to guess the PIN. The `student-login` Edge
-- Function checks the PIN/password against secret_hash here, enforces the attempt limits below, and only
-- then asks Supabase Auth for a normal session (admin.generateLink + verifyOtp). The session/JWT is
-- issued by Supabase Auth itself.
--
-- A "verified parent" = parent role + e-mail confirmed + phone confirmed (both by Supabase Auth OTP).

alter table public.student_credentials rename column pin_hash to secret_hash;   -- PIN or password
comment on column public.student_credentials.secret_hash is 'pbkdf2-sha256$<iterations>$<salt>$<hash>, written only by Edge Functions';

create function app.user_is_verified_parent(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_has_role(p_user, 'parent') and exists (
    select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null and u.phone_confirmed_at is not null)
$$;
create function app.is_verified_parent() returns boolean
language sql stable security definer set search_path = '' as $$ select app.user_is_verified_parent((select auth.uid())) $$;

-- a parent who is the VERIFIED guardian of this child (by user id – used by the service functions)
create function app.user_is_verified_guardian(p_user uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_is_verified_parent(p_user) and exists (
    select 1 from public.guardianships g
    where g.parent_id = p_user and g.student_id = p_student and g.status = 'active' and g.verified_at is not null)
$$;

-- ---------- devices a parent approved for PIN sign-in ----------
create table public.student_devices (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- the token itself lives only on the device
  label        text check (label is null or char_length(label) <= 40),
  enrolled_by  uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index student_devices_student on public.student_devices (student_id);
alter table public.student_devices enable row level security;
revoke all on public.student_devices from anon, authenticated;
grant select (id, student_id, label, created_at, last_used_at, revoked_at) on public.student_devices to authenticated;
create policy devices_select on public.student_devices for select to authenticated
  using (app.is_guardian_of(student_id) or app.is_admin());

-- ---------- every sign-in attempt (for limits). No API access. ----------
create table public.login_attempts (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  student_id uuid references public.students (id) on delete cascade,
  ip_hash    text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  ok         boolean not null
);
create index login_attempts_ip on public.login_attempts (ip_hash, at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

create trigger audit_student_devices after insert or update or delete on public.student_devices
  for each row execute function app.audit();

-- ---------- parent actions (signed-in, checked here) ----------
-- approve THIS device for a child's PIN sign-in; returns the device token once (store it on the device)
create function public.enroll_device(p_student uuid, p_label text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not app.user_is_verified_guardian((select auth.uid()), p_student) then
    raise exception 'only a verified parent of this child' using errcode = '42501';
  end if;
  insert into public.student_devices (student_id, token_hash, label, enrolled_by)
  values (p_student, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), nullif(btrim(left(p_label, 40)), ''), auth.uid());
  return tok;
end $$;

create function public.revoke_device(p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  select student_id into s from public.student_devices where id = p_device and revoked_at is null;
  if s is null or not app.is_guardian_of(s) then raise exception 'device not found' using errcode = '42501'; end if;
  update public.student_devices set revoked_at = now() where id = p_device;
end $$;

-- unlock a child after too many wrong attempts
create function public.release_student_lock(p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_guardian_of(p_student) then raise exception 'only a parent of this child' using errcode = '42501'; end if;
  update public.student_credentials set failed_count = 0, locked_until = null, hard_locked = false, updated_at = now()
  where student_id = p_student;
end $$;

revoke all on function public.enroll_device(uuid, text), public.revoke_device(uuid), public.release_student_lock(uuid) from public, anon;
grant execute on function public.enroll_device(uuid, text), public.revoke_device(uuid), public.release_student_lock(uuid) to authenticated;

-- ---------- service-only functions: called by Edge Functions with the service role, never by users ----------
create function public.srv_find_duplicate_child(p_parent uuid, p_full_name text, p_birth_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.guardianships g
  join public.students s on s.id = g.student_id
  join public.profiles p on p.id = s.id
  where g.parent_id = p_parent and g.status <> 'revoked' and s.birth_date = p_birth_date
    and lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
  limit 1
$$;

-- creates everything around a NEW auth user made by the Edge Function (auth.admin.createUser)
create function public.srv_register_student(
  p_parent uuid, p_student uuid, p_full_name text, p_birth_date date, p_grade text,
  p_login_mode text, p_username text, p_secret_hash text, p_relation text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.user_is_verified_parent(p_parent) then raise exception 'only a verified parent can create a student account' using errcode = '42501'; end if;
  if p_secret_hash !~ '^pbkdf2-sha256\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$' then raise exception 'bad secret hash'; end if;
  perform pg_advisory_xact_lock(hashtext('register-student:' || p_parent::text));   -- no double-click duplicates
  if public.srv_find_duplicate_child(p_parent, p_full_name, p_birth_date) is not null then
    raise exception 'this child already has an account' using errcode = '23505';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = p_student;
  if not found then raise exception 'auth user missing'; end if;
  insert into public.user_roles (user_id, role, status, granted_by) values (p_student, 'student', 'active', p_parent);
  insert into public.students (id, birth_date, grade, login_mode, username, created_by)
  values (p_student, p_birth_date, p_grade, p_login_mode, case when p_login_mode = 'password' then lower(p_username) end, p_parent);
  insert into public.guardianships (parent_id, student_id, relation, status, verified_at)
  values (p_parent, p_student, p_relation, 'active', now());
  insert into public.student_credentials (student_id, secret_hash) values (p_student, p_secret_hash);
end $$;

-- a verified guardian sets a new PIN/password (also clears any lock)
create function public.srv_set_secret(p_parent uuid, p_student uuid, p_secret_hash text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.user_is_verified_guardian(p_parent, p_student) then raise exception 'only a verified parent of this child' using errcode = '42501'; end if;
  if p_secret_hash !~ '^pbkdf2-sha256\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$' then raise exception 'bad secret hash'; end if;
  update public.student_credentials set secret_hash = p_secret_hash, failed_count = 0, locked_until = null, hard_locked = false, updated_at = now()
  where student_id = p_student;
end $$;

-- the picture grid of an enrolled device: first names and picture paths of the children approved on it
create function public.srv_device_profiles(p_device_hashes text[]) returns table (student_id uuid, first_name text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select s.id, split_part(btrim(p.full_name), ' ', 1), p.avatar_path
  from public.student_devices d join public.students s on s.id = d.student_id join public.profiles p on p.id = s.id
  where d.token_hash = any (p_device_hashes) and d.revoked_at is null and s.login_mode = 'pin' and p.status = 'active'
  limit 12
$$;

-- what the login function needs to check a secret. PIN: only from an approved device of that child.
create function public.srv_login_lookup(p_mode text, p_username text, p_student uuid, p_device_hash text)
returns table (student_id uuid, secret_hash text, email text)
language sql stable security definer set search_path = '' as $$
  select s.id, c.secret_hash, u.email
  from public.students s
  join public.student_credentials c on c.student_id = s.id
  join public.profiles p on p.id = s.id
  join auth.users u on u.id = s.id
  where p.status = 'active' and c.secret_hash is not null and (
        (p_mode = 'pin' and s.login_mode = 'pin' and s.id = p_student and exists (
            select 1 from public.student_devices d where d.student_id = s.id and d.token_hash = p_device_hash and d.revoked_at is null))
     or (p_mode = 'password' and s.login_mode = 'password' and s.username = lower(p_username)))
$$;

-- may this sign-in be tried at all? (account lock, and at most 30 attempts per address per 15 minutes)
create function public.srv_login_gate(p_student uuid, p_ip_hash text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.student_credentials;
begin
  if p_ip_hash is not null and (select count(*) from public.login_attempts a
      where a.ip_hash = p_ip_hash and a.at > now() - interval '15 minutes') >= 30 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_from_address');
  end if;
  if p_student is not null then
    select * into c from public.student_credentials where student_id = p_student;
    if c.hard_locked then return jsonb_build_object('allowed', false, 'reason', 'needs_parent'); end if;
    if c.locked_until > now() then return jsonb_build_object('allowed', false, 'reason', 'locked', 'until', c.locked_until); end if;
  end if;
  return jsonb_build_object('allowed', true);
end $$;

-- record the result atomically: 5 failures → 15 minutes; 10 → until a parent releases; success → reset
create function public.srv_login_record(p_student uuid, p_ip_hash text, p_ok boolean, p_device_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.student_credentials;
begin
  insert into public.login_attempts (student_id, ip_hash, ok) values (p_student, p_ip_hash, p_ok);
  if p_student is null then return jsonb_build_object('ok', false); end if;
  select * into c from public.student_credentials where student_id = p_student for update;
  if p_ok then
    update public.student_credentials set failed_count = 0, locked_until = null, updated_at = now() where student_id = p_student;
    if p_device_hash is not null then update public.student_devices set last_used_at = now() where token_hash = p_device_hash; end if;
    return jsonb_build_object('ok', true);
  end if;
  c.failed_count := c.failed_count + 1;
  if c.failed_count >= 10 then c.hard_locked := true;
  elsif c.failed_count % 5 = 0 then c.locked_until := now() + interval '15 minutes';
  end if;
  update public.student_credentials set failed_count = c.failed_count, locked_until = c.locked_until, hard_locked = c.hard_locked, updated_at = now()
  where student_id = p_student;
  return jsonb_build_object('ok', false, 'failed', c.failed_count, 'remaining', 5 - (c.failed_count % 5),
                            'locked_until', c.locked_until, 'hard_locked', c.hard_locked);
end $$;

create function public.srv_is_verified_parent(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select app.user_is_verified_parent(p_user) $$;

create function public.srv_username_taken(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.students s where s.username = lower(btrim(p_username)))
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.srv_is_verified_parent(uuid)',
    'public.srv_username_taken(text)',
    'public.srv_find_duplicate_child(uuid, text, date)',
    'public.srv_register_student(uuid, uuid, text, date, text, text, text, text, text)',
    'public.srv_set_secret(uuid, uuid, text)',
    'public.srv_device_profiles(text[])',
    'public.srv_login_lookup(text, text, uuid, text)',
    'public.srv_login_gate(uuid, text)',
    'public.srv_login_record(uuid, text, boolean, text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
