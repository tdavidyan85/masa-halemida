-- Phase 4: learning materials (PDF / images) in private storage, extracted text, editable topics, generated
-- content drafts that need an adult's review, and sharing with authorised groups / own children.
-- Students never upload, never edit, never see drafts.

alter table public.learning_materials
  add column mime_type text check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  add column size_bytes int check (size_bytes between 1 and 20971520),
  add column extraction_status text not null default 'pending' check (extraction_status in ('pending', 'done', 'failed', 'unsupported')),
  add column extracted_text text check (extracted_text is null or char_length(extracted_text) <= 200000),
  add column page_count int check (page_count is null or page_count between 0 and 500);
-- the server decides where the file lives: "<owner>/<material id>/source.<ext>"; users never choose a path
create unique index learning_materials_path on public.learning_materials (storage_path) where storage_path is not null;

-- no more direct inserts/updates: create_material() / save_extraction() check the caller and the values
drop policy materials_insert on public.learning_materials;
drop policy materials_update on public.learning_materials;
revoke insert, update on public.learning_materials from authenticated;

create table public.material_topics (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.learning_materials (id) on delete cascade,
  position    int not null check (position between 1 and 200),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 20000),
  unique (material_id, position) deferrable initially deferred
);

-- generated learning content (masa-pack/1). Always a DRAFT until the owner approves it.
create table public.content_drafts (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.learning_materials (id) on delete cascade,
  created_by  uuid references public.profiles (id) on delete set null,
  provider    text not null check (provider in ('template', 'ai')),        -- template = rule-based, no AI
  pack        jsonb not null check (pack ->> 'schema' = 'masa-pack/1' and pg_column_size(pack) <= 300000),
  status      text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.material_shares (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.learning_materials (id) on delete cascade,
  group_id    uuid references public.groups (id) on delete cascade,
  student_id  uuid references public.students (id) on delete cascade,
  shared_by   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((group_id is null) <> (student_id is null))
);
create unique index material_shares_once on public.material_shares (material_id, coalesce(group_id, student_id));

-- ---------- helpers ----------
create function app.owns_material(p_material uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.learning_materials m where m.id = p_material and m.owner_id = (select auth.uid()))
     and (app.has_role('teacher') or app.has_role('parent'))
$$;
-- who may read a shared material (title + file): owner, admin, teachers/students/parents of a shared group,
-- the child it was shared with and that child's parents
create function app.can_read_material(p_material uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.owns_material(p_material) or app.is_admin() or exists (
    select 1 from public.material_shares sh where sh.material_id = p_material and (
      (sh.group_id is not null and (app.teaches_group(sh.group_id) or app.member_of_group(sh.group_id) or app.child_in_group(sh.group_id)))
      or (sh.student_id is not null and (sh.student_id = (select auth.uid()) or app.is_guardian_of(sh.student_id)))))
$$;
create function app.material_of_object(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/source\.(pdf|jpg|png|webp)$' then split_part(p_name, '/', 2)::uuid end
$$;
revoke all on function app.owns_material(uuid), app.can_read_material(uuid), app.material_of_object(text) from public;
grant execute on function app.owns_material(uuid), app.can_read_material(uuid), app.material_of_object(text) to authenticated;

-- ---------- RLS ----------
drop policy materials_select on public.learning_materials;
create policy materials_select on public.learning_materials for select to authenticated
  using (owner_id = (select auth.uid()) or app.can_read_material(id));
-- extracted text is the owner's working material: only the owner reads it (column grant + RPC for others: none)
revoke select on public.learning_materials from authenticated;
grant select (id, owner_id, title, storage_path, status, created_at, mime_type, size_bytes, extraction_status, page_count) on public.learning_materials to authenticated;

do $$
declare t text;
begin
  foreach t in array array['material_topics', 'content_drafts', 'material_shares'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- topics: owner only (draft working space), edited directly
grant select, delete on public.material_topics to authenticated;
grant insert (material_id, position, title, body) on public.material_topics to authenticated;
grant update (position, title, body) on public.material_topics to authenticated;
create policy topics_owner on public.material_topics for all to authenticated
  using (app.owns_material(material_id)) with check (app.owns_material(material_id));

-- drafts: owner reads; written only by save_content_draft / review RPCs (or the generate-content function)
grant select on public.content_drafts to authenticated;
create policy drafts_owner on public.content_drafts for select to authenticated using (app.owns_material(material_id) or app.is_admin());

grant select on public.material_shares to authenticated;
create policy shares_select on public.material_shares for select to authenticated using (app.can_read_material(material_id));

-- ---------- storage: private bucket, server-chosen paths ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy materials_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and exists (
    select 1 from public.learning_materials m
    where m.id = app.material_of_object(name) and m.storage_path = name and m.owner_id = (select auth.uid()))
    and (app.has_role('teacher') or app.has_role('parent')) and not app.has_role('student'));
create policy materials_read on storage.objects for select to authenticated
  using (bucket_id = 'materials' and app.can_read_material(app.material_of_object(name)));
create policy materials_delete on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and app.owns_material(app.material_of_object(name)));

-- ---------- operations ----------
create function public.create_material(p_title text, p_mime text, p_size int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare id uuid := gen_random_uuid(); ext text; path text;
begin
  if not (app.has_role('teacher') or app.has_role('parent')) or app.has_role('student') then
    raise exception 'only teachers and parents add learning material' using errcode = '42501'; end if;
  ext := case p_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if ext is null then raise exception 'only PDF, JPEG, PNG or WebP'; end if;
  if p_size is null or p_size < 1 or p_size > 20971520 then raise exception 'the file must be at most 20 MB'; end if;
  if (select count(*) from public.learning_materials where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too many uploads today'; end if;
  path := auth.uid()::text || '/' || id::text || '/source.' || ext;
  insert into public.learning_materials (id, owner_id, title, storage_path, mime_type, size_bytes, extraction_status)
  values (id, auth.uid(), btrim(left(p_title, 120)), path, p_mime, p_size, case when ext = 'pdf' then 'pending' else 'unsupported' end);
  return jsonb_build_object('id', id, 'path', path);
end $$;

create function public.save_extraction(p_material uuid, p_text text, p_pages int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.owns_material(p_material) then raise exception 'not your material' using errcode = '42501'; end if;
  update public.learning_materials set extracted_text = left(p_text, 200000), page_count = least(greatest(coalesce(p_pages, 0), 0), 500),
    extraction_status = case when coalesce(btrim(p_text), '') = '' then 'failed' else 'done' end
  where id = p_material;
end $$;

-- the owner reads their extracted text (it is not exposed as a column)
create function public.material_text(p_material uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.extracted_text from public.learning_materials m where m.id = p_material and app.owns_material(p_material)
$$;

create function public.save_content_draft(p_material uuid, p_pack jsonb, p_provider text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  if not app.owns_material(p_material) then raise exception 'not your material' using errcode = '42501'; end if;
  if p_provider <> 'template' then raise exception 'AI drafts are written by the server only' using errcode = '42501'; end if;
  if jsonb_typeof(p_pack -> 'topics') <> 'array' or jsonb_typeof(p_pack -> 'pools') <> 'object' then raise exception 'not a masa-pack/1'; end if;
  insert into public.content_drafts (material_id, created_by, provider, pack) values (p_material, auth.uid(), p_provider, p_pack) returning content_drafts.id into id;
  return id;
end $$;

create function public.review_content_draft(p_draft uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.content_drafts;
begin
  select * into d from public.content_drafts where id = p_draft for update;
  if d.id is null or not app.owns_material(d.material_id) then raise exception 'not your draft' using errcode = '42501'; end if;
  if d.status <> 'draft' then raise exception 'already reviewed'; end if;
  update public.content_drafts set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now() where id = p_draft;
end $$;

create function public.share_material(p_material uuid, p_group uuid, p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.owns_material(p_material) then raise exception 'not your material' using errcode = '42501'; end if;
  if (p_group is null) = (p_student is null) then raise exception 'share with one group or one child'; end if;
  if p_group is not null and not app.teaches_group(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  if p_student is not null and not app.is_guardian_of(p_student) then raise exception 'not your child' using errcode = '42501'; end if;
  insert into public.material_shares (material_id, group_id, student_id, shared_by) values (p_material, p_group, p_student, auth.uid())
  on conflict do nothing;
end $$;

-- an APPROVED draft's multiple-choice questions become a DRAFT quiz assignment (still needs publishing)
create function public.quiz_from_draft(p_draft uuid, p_group uuid, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.content_drafts; aid uuid; pool jsonb; it jsonb; pos int := 0; iid uuid; opts text[]; ans int;
begin
  select * into d from public.content_drafts where id = p_draft;
  if d.id is null or not app.owns_material(d.material_id) then raise exception 'not your draft' using errcode = '42501'; end if;
  if d.status <> 'approved' then raise exception 'approve the content first'; end if;
  if not app.teaches_group(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  insert into public.assignments (group_id, created_by, title, kind) values (p_group, auth.uid(), btrim(left(p_title, 120)), 'quiz') returning id into aid;
  for pool in select value from jsonb_each(d.pack -> 'pools') loop
    for it in select value from jsonb_array_elements(pool -> 'items') loop
      exit when pos >= 20;
      continue when coalesce(it ->> 'type', pool -> 'defaults' ->> 'type', 'choice') <> 'choice' or jsonb_typeof(it -> 'options') <> 'array';
      select array_agg(x) into opts from jsonb_array_elements_text(it -> 'options') x;
      continue when cardinality(opts) not between 2 and 6;
      ans := array_position(opts, it ->> 'answer') - 1;
      continue when ans is null;
      pos := pos + 1;
      insert into public.assignment_items (assignment_id, position, prompt, options) values (aid, pos, left(it ->> 'text', 500), opts) returning id into iid;
      insert into public.assignment_answer_keys (item_id, answer_index) values (iid, ans);
    end loop;
  end loop;
  if pos = 0 then raise exception 'the content has no multiple-choice questions'; end if;
  return aid;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.create_material(text, text, int)', 'public.save_extraction(uuid, text, int)', 'public.material_text(uuid)',
    'public.save_content_draft(uuid, jsonb, text)', 'public.review_content_draft(uuid, boolean)', 'public.share_material(uuid, uuid, uuid)',
    'public.quiz_from_draft(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- AI drafts are written by the generate-content Edge Function (service role) after it checked the caller
create function public.srv_save_ai_draft(p_user uuid, p_material uuid, p_pack jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  if not exists (select 1 from public.learning_materials m where m.id = p_material and m.owner_id = p_user) then
    raise exception 'not your material' using errcode = '42501'; end if;
  insert into public.content_drafts (material_id, created_by, provider, pack) values (p_material, p_user, 'ai', p_pack) returning content_drafts.id into id;
  return id;
end $$;
revoke all on function public.srv_save_ai_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.srv_save_ai_draft(uuid, uuid, jsonb) to service_role;

-- the audit log never copies learning content or extracted text (size, and it may contain names from a worksheet)
create or replace function app.audit() returns trigger
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
          r - 'full_name' - 'avatar_path' - 'child_hint' - 'contact_hash' - 'storage_path' - 'title'
            - 'pack' - 'extracted_text' - 'body' - 'prompt' - 'options' - 'instructions');
  return coalesce(new, old);
end $$;

create trigger audit_content_drafts after insert or update on public.content_drafts for each row execute function app.audit();
create trigger audit_material_shares after insert or delete on public.material_shares for each row execute function app.audit();
