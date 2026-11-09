-- Parental consent (the gate for any teacher access) and teacher → parent invitations.

create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  guardian_id  uuid not null references public.profiles (id),
  scope        text not null check (scope in ('group', 'ai_material', 'photo', 'voice')),
  group_id     uuid references public.groups (id) on delete cascade,
  text_version text not null check (char_length(text_version) between 1 and 40), -- which consent wording was shown
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles (id),
  check ((scope = 'group') = (group_id is not null))
);
-- at most one active consent per child + scope (+ group)
create unique index consents_one_active on public.consents
  (student_id, scope, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;

alter table public.group_members
  add constraint group_members_consent_fk foreign key (consent_id) references public.consents (id);

create table public.invitations (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups (id) on delete cascade,
  invited_by          uuid not null references public.profiles (id),
  -- sha-256 of the parent's normalised e-mail: the address itself is not stored
  contact_hash        text not null check (contact_hash ~ '^[0-9a-f]{64}$'),
  child_hint          text check (child_hint is null or char_length(child_hint) <= 40),
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at          timestamptz not null default now() + interval '7 days',
  responded_at        timestamptz,
  accepted_student_id uuid references public.students (id),
  created_at          timestamptz not null default now()
);
create index invitations_contact on public.invitations (contact_hash) where status = 'pending';

-- revoking a group consent removes the child from that group at once (access is also checked per query)
create function app.consent_revoked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and new.scope = 'group' then
    update public.group_members set status = 'removed'
    where group_id = new.group_id and student_id = new.student_id and status = 'active';
  end if;
  return new;
end $$;
create trigger consents_revoked after update on public.consents
  for each row execute function app.consent_revoked();
