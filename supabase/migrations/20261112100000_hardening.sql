-- Phase 5 hardening (from the security audit) + OCR confidence + draft editing + AI spending safeguards.

-- ---------- OCR ----------
alter table public.learning_materials add column extraction_confidence int check (extraction_confidence is null or extraction_confidence between 0 and 100);
grant select (extraction_confidence) on public.learning_materials to authenticated;
drop function public.save_extraction(uuid, text, int);
create function public.save_extraction(p_material uuid, p_text text, p_pages int, p_confidence int default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.owns_material(p_material) then raise exception 'not your material' using errcode = '42501'; end if;
  update public.learning_materials set extracted_text = left(p_text, 200000), page_count = least(greatest(coalesce(p_pages, 0), 0), 500),
    extraction_confidence = case when p_confidence is null then null else least(greatest(p_confidence, 0), 100) end,
    extraction_status = case when coalesce(btrim(p_text), '') = '' then 'failed' else 'done' end
  where id = p_material;
end $$;
-- images are no longer "unsupported": they are read by the local OCR in the browser
update public.learning_materials set extraction_status = 'pending' where extraction_status = 'unsupported';
create or replace function public.create_material(p_title text, p_mime text, p_size int) returns jsonb
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
  values (id, auth.uid(), btrim(left(p_title, 120)), path, p_mime, p_size, 'pending');
  return jsonb_build_object('id', id, 'path', path);
end $$;

-- ---------- audit finding A1: unbounded writes (storage/abuse) ----------
create or replace function public.start_session(p_assignment uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; sid uuid;
begin
  a := app.require_student_on(p_assignment);
  -- audit finding A2: practice telemetry must not land on a quiz (a quiz is answered through submit_quiz only)
  if a.kind = 'quiz' then raise exception 'a quiz is answered, not practised'; end if;
  if (select count(*) from public.learning_sessions where student_id = auth.uid() and started_at > now() - interval '1 day') >= 200 then
    raise exception 'too many sessions today'; end if;
  insert into public.learning_sessions (student_id, assignment_id, source) values (auth.uid(), p_assignment, 'player') returning id into sid;
  if p_assignment is not null then
    insert into public.assignment_status (assignment_id, student_id) values (p_assignment, auth.uid()) on conflict do nothing;
  end if;
  return sid;
end $$;

create function app.session_events_left(p_session uuid) returns int
language sql stable security definer set search_path = '' as $$
  select 3000 - count(*)::int from public.progress_events where session_id = p_session
$$;
revoke all on function app.session_events_left(uuid) from public;
create or replace function public.record_progress(p_session uuid, p_events jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.learning_sessions; e jsonb; n int := 0; added int;
begin
  if not app.has_role('student') then raise exception 'students only' using errcode = '42501'; end if;
  select * into s from public.learning_sessions where id = p_session;
  if s.id is null or s.student_id <> auth.uid() then raise exception 'session not found' using errcode = '42501'; end if;
  if s.ended_at is not null and s.ended_at < now() - interval '1 hour' then raise exception 'session closed'; end if;
  if s.assignment_id is not null then perform app.require_student_on(s.assignment_id); end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then raise exception 'send 1–50 events'; end if;
  if app.session_events_left(s.id) < jsonb_array_length(p_events) then raise exception 'session is full – start a new one'; end if;
  for e in select * from jsonb_array_elements(p_events) loop
    insert into public.progress_events (id, session_id, student_id, assignment_id, kind, skill, topic, correct_first, ms)
    values ((e ->> 'id')::uuid, s.id, s.student_id, s.assignment_id, e ->> 'kind', left(e ->> 'skill', 60), left(e ->> 'topic', 60),
            case when e ->> 'kind' = 'question' then (e ->> 'ok')::boolean end,
            least(greatest(coalesce((e ->> 'ms')::int, 0), 0), 86400000))
    on conflict (id) do nothing;
    get diagnostics added = row_count;
    if added = 1 and s.assignment_id is not null then
      update public.assignment_status set
        practice_questions = practice_questions + (case when e ->> 'kind' = 'question' then 1 else 0 end),
        practice_first_try = practice_first_try + (case when e ->> 'kind' = 'question' and (e ->> 'ok')::boolean then 1 else 0 end),
        state = case when state = 'completed' then state when e ->> 'kind' = 'round_done' then 'practiced' else state end,
        last_activity_at = now()
      where assignment_id = s.assignment_id and student_id = s.student_id;
    end if;
    n := n + added;
  end loop;
  return n;
end $$;

create or replace function public.enroll_device(p_student uuid, p_label text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not app.user_is_verified_guardian((select auth.uid()), p_student) then
    raise exception 'only a verified parent of this child' using errcode = '42501';
  end if;
  if (select count(*) from public.student_devices where student_id = p_student and revoked_at is null) >= 10 then
    raise exception 'at most 10 approved devices per child – revoke an old one first'; end if;
  insert into public.student_devices (student_id, token_hash, label, enrolled_by)
  values (p_student, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), nullif(btrim(left(p_label, 40)), ''), auth.uid());
  return tok;
end $$;

create or replace function public.create_invitation(p_group uuid, p_parent_email text, p_child_hint text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv uuid;
begin
  if not app.teaches_group(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  if exists (select 1 from public.groups g where g.id = p_group and g.archived_at is not null) then raise exception 'the group is archived'; end if;
  if p_parent_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad e-mail address'; end if;
  if (select count(*) from public.invitations where invited_by = auth.uid() and created_at > now() - interval '1 day') >= 100 then
    raise exception 'too many invitations today'; end if;
  insert into public.invitations (group_id, invited_by, contact_hash, child_hint)
  values (p_group, auth.uid(), app.email_hash(p_parent_email), nullif(btrim(left(p_child_hint, 40)), ''))
  returning id into inv;
  return inv;
end $$;

create or replace function public.save_content_draft(p_material uuid, p_pack jsonb, p_provider text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  if not app.owns_material(p_material) then raise exception 'not your material' using errcode = '42501'; end if;
  if p_provider <> 'template' then raise exception 'AI drafts are written by the server only' using errcode = '42501'; end if;
  if jsonb_typeof(p_pack -> 'topics') <> 'array' or jsonb_typeof(p_pack -> 'pools') <> 'object' then raise exception 'not a masa-pack/1'; end if;
  if (select count(*) from public.content_drafts where material_id = p_material) >= 30 then raise exception 'too many drafts for this material'; end if;
  -- the label follows the provider: a template draft is always marked as template
  insert into public.content_drafts (material_id, created_by, provider, pack)
  values (p_material, auth.uid(), 'template', jsonb_set(p_pack, '{generator}', jsonb_build_object('kind', 'template'))) returning content_drafts.id into id;
  return id;
end $$;

-- ---------- review: edit a draft before approving it (the provider label stays; "edited" is recorded) ----------
create function public.update_content_draft(p_draft uuid, p_pack jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.content_drafts;
begin
  select * into d from public.content_drafts where id = p_draft for update;
  if d.id is null or not app.owns_material(d.material_id) then raise exception 'not your draft' using errcode = '42501'; end if;
  if d.status <> 'draft' then raise exception 'only a draft can be edited'; end if;
  if p_pack ->> 'schema' <> 'masa-pack/1' or jsonb_typeof(p_pack -> 'topics') <> 'array' or jsonb_typeof(p_pack -> 'pools') <> 'object' then raise exception 'not a masa-pack/1'; end if;
  update public.content_drafts set pack = jsonb_set(p_pack, '{generator}', jsonb_build_object('kind', d.provider, 'edited', true)) where id = p_draft;
end $$;

-- ---------- quiz from an approved draft: chosen questions only, bounded sizes ----------
drop function public.quiz_from_draft(uuid, uuid, text);
create function public.quiz_from_draft(p_draft uuid, p_group uuid, p_title text, p_items text[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.content_drafts; aid uuid; pool record; it jsonb; pos int := 0; iid uuid; opts text[]; ans int;
begin
  select * into d from public.content_drafts where id = p_draft;
  if d.id is null or not app.owns_material(d.material_id) then raise exception 'not your draft' using errcode = '42501'; end if;
  if d.status <> 'approved' then raise exception 'approve the content first'; end if;
  if not app.teaches_group(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  insert into public.assignments (group_id, created_by, title, kind) values (p_group, auth.uid(), btrim(left(p_title, 120)), 'quiz') returning id into aid;
  for pool in select key, value from jsonb_each(d.pack -> 'pools') loop
    for it in select value from jsonb_array_elements(pool.value -> 'items') loop
      exit when pos >= 20;
      continue when p_items is not null and not ((pool.key || '/' || coalesce(it ->> 'id', '')) = any (p_items));
      continue when coalesce(it ->> 'type', pool.value -> 'defaults' ->> 'type', 'choice') <> 'choice' or jsonb_typeof(it -> 'options') <> 'array';
      select array_agg(left(x, 200)) into opts from jsonb_array_elements_text(it -> 'options') x;
      continue when cardinality(opts) not between 2 and 6 or coalesce(btrim(it ->> 'text'), '') = '';
      ans := array_position(opts, left(it ->> 'answer', 200)) - 1;
      continue when ans is null;
      pos := pos + 1;
      insert into public.assignment_items (assignment_id, position, prompt, options) values (aid, pos, left(it ->> 'text', 500), opts) returning id into iid;
      insert into public.assignment_answer_keys (item_id, answer_index) values (iid, ans);
    end loop;
  end loop;
  if pos = 0 then raise exception 'the content has no multiple-choice questions'; end if;
  return aid;
end $$;

-- ---------- AI spending safeguards (server only) ----------
create table public.ai_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles (id) on delete set null,
  material_id     uuid references public.learning_materials (id) on delete set null,
  at              timestamptz not null default now(),
  status          text not null default 'reserved' check (status in ('reserved', 'ok', 'failed')),
  reserved_tokens int not null check (reserved_tokens > 0),
  tokens_in       int,
  tokens_out      int
);
create index ai_requests_user_at on public.ai_requests (user_id, at desc);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon, authenticated;

-- reserve BEFORE calling the provider; failed and invalid outputs still count (they cost money too)
create function public.srv_ai_reserve(p_user uuid, p_material uuid, p_tokens int, p_daily_limit int, p_monthly_budget bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare used bigint; today int; rid uuid;
begin
  if p_monthly_budget is null or p_monthly_budget <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_budget'); end if;
  perform pg_advisory_xact_lock(hashtext('ai-budget'));
  select count(*) into today from public.ai_requests where user_id = p_user and at > now() - interval '1 day';
  if today >= p_daily_limit then return jsonb_build_object('ok', false, 'reason', 'daily_limit'); end if;
  select coalesce(sum(case when status = 'reserved' then reserved_tokens else coalesce(tokens_in, 0) + coalesce(tokens_out, 0) end), 0) into used
  from public.ai_requests where at >= date_trunc('month', now());
  if used + p_tokens > p_monthly_budget then return jsonb_build_object('ok', false, 'reason', 'monthly_budget'); end if;
  insert into public.ai_requests (user_id, material_id, reserved_tokens) values (p_user, p_material, p_tokens) returning id into rid;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;
create function public.srv_ai_finish(p_request uuid, p_ok boolean, p_in int, p_out int) returns void
language sql security definer set search_path = '' as $$
  update public.ai_requests set status = case when p_ok then 'ok' else 'failed' end, tokens_in = p_in, tokens_out = p_out where id = p_request
$$;

do $$
declare f text;
begin
  foreach f in array array['public.save_extraction(uuid, text, int, int)', 'public.update_content_draft(uuid, jsonb)', 'public.quiz_from_draft(uuid, uuid, text, text[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.srv_ai_reserve(uuid, uuid, int, int, bigint)', 'public.srv_ai_finish(uuid, boolean, int, int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
