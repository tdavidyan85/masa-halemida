-- Groups, their teachers and their students.

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  subject     text not null check (subject in ('math', 'english', 'hebrew', 'science', 'other')),
  grade       text not null check (grade in ('גן', 'א', 'ב', 'ג', 'ד', 'ה', 'ו')),
  created_by  uuid not null default auth.uid() references public.profiles (id),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.group_teachers (
  group_id   uuid not null references public.groups (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('owner', 'co')),
  added_at   timestamptz not null default now(),
  primary key (group_id, teacher_id)
);
create unique index group_teachers_one_owner on public.group_teachers (group_id) where role = 'owner';

create table public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  status     text not null default 'active' check (status in ('active', 'removed')),
  consent_id uuid,                            -- FK added with the consents table
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,
  primary key (group_id, student_id)
);
create index group_members_student on public.group_members (student_id);

-- the teacher who creates a group becomes its owner
create function app.group_owner_on_create() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_teachers (group_id, teacher_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger groups_owner after insert on public.groups
  for each row execute function app.group_owner_on_create();

create function app.member_removed_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'removed' and old.status <> 'removed' then new.removed_at := now(); end if;
  return new;
end $$;
create trigger group_members_removed_at before update on public.group_members
  for each row execute function app.member_removed_at();
