-- Learning materials (metadata only for now) and the append-only audit log.

create table public.learning_materials (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 120),
  storage_path text,
  status       text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready_for_review', 'approved')),
  created_at   timestamptz not null default now()
);
comment on table public.learning_materials is 'Uploaded study material. Only teachers and parents may add; students never.';

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,                     -- auth.uid() of whoever made the change (null = server/service)
  action     text not null,            -- INSERT / UPDATE / DELETE
  table_name text not null,
  row_key    text,
  details    jsonb not null default '{}'::jsonb
);
create index audit_log_at on public.audit_log (at desc);

create function app.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.audit_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_append_only();

-- generic audit trigger. Personal free text (names, hints, paths, hashes) is never copied into the log.
create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  k text;
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    if (to_jsonb(new) ->> 'status') is not distinct from (to_jsonb(old) ->> 'status') then
      return new;                                 -- only status changes of profiles are audited
    end if;
  end if;
  k := coalesce(r ->> 'id', concat_ws(':', r ->> 'user_id', r ->> 'role', r ->> 'group_id', r ->> 'teacher_id', r ->> 'student_id', r ->> 'parent_id'));
  insert into public.audit_log (actor, action, table_name, row_key, details)
  values ((select auth.uid()), tg_op, tg_table_name, k,
          r - 'full_name' - 'avatar_path' - 'child_hint' - 'contact_hash' - 'storage_path' - 'title');
  return coalesce(new, old);
end $$;

create trigger audit_profiles after update on public.profiles for each row execute function app.audit();
create trigger audit_user_roles after insert or update or delete on public.user_roles for each row execute function app.audit();
create trigger audit_guardianships after insert or update or delete on public.guardianships for each row execute function app.audit();
create trigger audit_group_teachers after insert or update or delete on public.group_teachers for each row execute function app.audit();
create trigger audit_group_members after insert or update or delete on public.group_members for each row execute function app.audit();
create trigger audit_consents after insert or update or delete on public.consents for each row execute function app.audit();
create trigger audit_invitations after insert or update or delete on public.invitations for each row execute function app.audit();
