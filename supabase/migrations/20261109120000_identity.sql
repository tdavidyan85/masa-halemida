-- Identity: profiles (one per auth user) and roles.
-- New tables only; nothing existing (feedback, usage_events, tts_usage, packs) is touched.

create schema if not exists app;          -- internal helpers; not exposed through the API
comment on schema app is 'Internal helper functions for RLS. Not part of the public API.';

create type public.app_role as enum ('admin', 'teacher', 'parent', 'student');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(btrim(full_name)) between 1 and 120),
  -- private storage object "<user id>/<file>" in the avatars bucket (see the storage migration)
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'One row per user (adult or student). Real names – visible only as the RLS rules allow.';

create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  -- a teacher asks for the role and waits ("pending") until an admin approves it
  status     text not null default 'active' check (status in ('pending', 'active', 'revoked')),
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
comment on table public.user_roles is 'Roles. Users can never write here directly: only request_role() (parent/teacher) and admin functions.';

-- a student account is a student only: never also a teacher, parent or admin
create function app.student_role_is_exclusive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'revoked' and exists (
    select 1 from public.user_roles r
    where r.user_id = new.user_id and r.role <> new.role and r.status <> 'revoked'
      and (r.role = 'student' or new.role = 'student')
  ) then
    raise exception 'a student account cannot hold another role' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger user_roles_student_exclusive before insert or update on public.user_roles
  for each row execute function app.student_role_is_exclusive();

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- every new auth user gets a profile. Only the NAME is taken from the sign-up metadata (which the
-- user controls); a role is NEVER taken from it – roles come only from request_role() or an admin.
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(btrim(left(new.raw_user_meta_data ->> 'full_name', 120)), ''), 'משתמש/ת חדש/ה'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
