-- Phase 3: assignments, learning sessions, progress and results.
--
-- Two kinds of evidence, never mixed:
--   * practice telemetry (progress_events, assignment_status.practice_*): reported by the student's browser
--     while using the learning engine. UNVERIFIED – the client could lie. Shown as "practice", never as a grade.
--   * verified results (quiz_attempts, assignment_status.verified_*): a quiz is graded HERE, against answer keys
--     that students can never read. Only these count as results.
-- Every write goes through SECURITY DEFINER functions that check the caller; students have no direct writes.

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  created_by   uuid not null default auth.uid() references public.profiles (id),
  title        text not null check (char_length(btrim(title)) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 1000),
  kind         text not null check (kind in ('practice', 'quiz', 'reading')),
  -- practice opens the existing engine at one of these paths (allow-list, never a free URL)
  player_path  text check (player_path is null or player_path in ('math/', 'english/', 'fractions/')),
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  due_at       date,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (kind <> 'practice' or player_path is not null)
);
create index assignments_group on public.assignments (group_id);
create trigger assignments_touch before update on public.assignments for each row execute function app.touch_updated_at();

-- quiz questions: what students may see
create table public.assignment_items (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  position      int not null check (position between 1 and 50),
  prompt        text not null check (char_length(btrim(prompt)) between 1 and 500),
  options       text[] not null check (cardinality(options) between 2 and 6),
  unique (assignment_id, position)
);
-- and the answers: teachers only, never students or parents
create table public.assignment_answer_keys (
  item_id      uuid primary key references public.assignment_items (id) on delete cascade,
  answer_index int not null check (answer_index between 0 and 5)
);

create table public.learning_sessions (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  source        text not null check (source in ('player', 'quiz')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index learning_sessions_student on public.learning_sessions (student_id, started_at desc);

-- UNVERIFIED practice telemetry. id = the client's event id → idempotent (a resent batch adds nothing)
create table public.progress_events (
  id            uuid primary key,
  session_id    uuid not null references public.learning_sessions (id) on delete cascade,
  student_id    uuid not null references public.students (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  kind          text not null check (kind in ('question', 'round_done')),
  skill         text check (skill is null or char_length(skill) <= 60),
  topic         text check (topic is null or char_length(topic) <= 60),
  correct_first boolean,
  ms            int check (ms is null or ms between 0 and 86400000),
  at            timestamptz not null default now()
);
create index progress_events_student on public.progress_events (student_id, at desc);

-- server-graded quiz attempts = VERIFIED results
create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id    uuid not null references public.students (id) on delete cascade,
  attempt_no    int not null check (attempt_no between 1 and 3),
  answers       int[] not null,
  score         int not null,
  max_score     int not null,
  submitted_at  timestamptz not null default now(),
  late          boolean not null default false,
  unique (assignment_id, student_id, attempt_no)
);

create table public.assignment_status (
  assignment_id      uuid not null references public.assignments (id) on delete cascade,
  student_id         uuid not null references public.students (id) on delete cascade,
  state              text not null default 'in_progress' check (state in ('in_progress', 'practiced', 'completed')),
  practice_questions int not null default 0,          -- unverified
  practice_first_try int not null default 0,          -- unverified
  verified_score     int,                             -- best server-graded score (quiz)
  verified_max       int,
  attempts           int not null default 0,
  last_activity_at   timestamptz not null default now(),
  primary key (assignment_id, student_id)
);

-- ---------- visibility helpers ----------
create function app.can_see_assignment(p_assignment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignments a where a.id = p_assignment and (
      app.is_admin() or app.teaches_group(a.group_id)
      or (a.status = 'published' and (app.member_of_group(a.group_id) or app.child_in_group(a.group_id)))))
$$;
-- may the caller see this student's learning data for this assignment (or free practice: assignment null)?
create function app.can_see_learning(p_student uuid, p_assignment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_student = (select auth.uid()) or app.is_admin() or app.is_guardian_of(p_student)
      or (p_assignment is not null and exists (
            select 1 from public.assignments a
            where a.id = p_assignment and app.teaches_group(a.group_id) and app.teaches_student(p_student)
              and app.consent_active(p_student, 'group', a.group_id)))
$$;
revoke all on function app.can_see_assignment(uuid), app.can_see_learning(uuid, uuid) from public;
grant execute on function app.can_see_assignment(uuid), app.can_see_learning(uuid, uuid) to authenticated;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['assignments','assignment_items','assignment_answer_keys','learning_sessions','progress_events','quiz_attempts','assignment_status']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.assignments to authenticated;
grant insert (group_id, title, instructions, kind, player_path, due_at) on public.assignments to authenticated;
grant update (title, instructions, kind, player_path, due_at) on public.assignments to authenticated;
-- evaluated on the row itself (not by id), so INSERT … RETURNING sees the row it just created
create policy assignments_select on public.assignments for select to authenticated
  using (app.is_admin() or app.teaches_group(group_id)
      or (status = 'published' and (app.member_of_group(group_id) or app.child_in_group(group_id))));
create policy assignments_insert on public.assignments for insert to authenticated
  with check (app.teaches_group(group_id) and created_by = (select auth.uid()));
-- content can be edited while draft; published work is changed only by archiving (rpc)
create policy assignments_update on public.assignments for update to authenticated
  using (app.teaches_group(group_id) and status = 'draft') with check (app.teaches_group(group_id) and status = 'draft');

grant select on public.assignment_items to authenticated;
grant insert (assignment_id, position, prompt, options) on public.assignment_items to authenticated;
grant update (position, prompt, options) on public.assignment_items to authenticated;
grant delete on public.assignment_items to authenticated;
create policy items_select on public.assignment_items for select to authenticated using (app.can_see_assignment(assignment_id));
create policy items_write on public.assignment_items for all to authenticated
  using (exists (select 1 from public.assignments a where a.id = assignment_id and app.teaches_group(a.group_id) and a.status = 'draft'))
  with check (exists (select 1 from public.assignments a where a.id = assignment_id and app.teaches_group(a.group_id) and a.status = 'draft'));

grant select, insert, update, delete on public.assignment_answer_keys to authenticated;
create function app.key_editable(p_item uuid, p_need_draft boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignment_items i join public.assignments a on a.id = i.assignment_id
                 where i.id = p_item and app.teaches_group(a.group_id) and (not p_need_draft or a.status = 'draft'))
$$;
revoke all on function app.key_editable(uuid, boolean) from public;
grant execute on function app.key_editable(uuid, boolean) to authenticated;
-- teachers read keys any time; keys change only while the quiz is a draft (a published quiz is never re-graded)
create policy keys_select on public.assignment_answer_keys for select to authenticated using (app.key_editable(item_id, false));
create policy keys_insert on public.assignment_answer_keys for insert to authenticated with check (app.key_editable(item_id, true));
create policy keys_update on public.assignment_answer_keys for update to authenticated using (app.key_editable(item_id, true)) with check (app.key_editable(item_id, true));
create policy keys_delete on public.assignment_answer_keys for delete to authenticated using (app.key_editable(item_id, true));

grant select on public.learning_sessions, public.progress_events, public.quiz_attempts, public.assignment_status to authenticated;
create policy sessions_select on public.learning_sessions for select to authenticated using (app.can_see_learning(student_id, assignment_id));
create policy events_select on public.progress_events for select to authenticated using (app.can_see_learning(student_id, assignment_id));
create policy attempts_select on public.quiz_attempts for select to authenticated using (app.can_see_learning(student_id, assignment_id));
create policy status_select on public.assignment_status for select to authenticated using (app.can_see_learning(student_id, assignment_id));

-- ---------- teacher operations ----------
create function public.publish_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assignments;
begin
  select * into a from public.assignments where id = p_assignment for update;
  if a.id is null or not app.teaches_group(a.group_id) then raise exception 'not your assignment' using errcode = '42501'; end if;
  if a.status <> 'draft' then raise exception 'only a draft can be published'; end if;
  if a.kind = 'quiz' and (
       not exists (select 1 from public.assignment_items i where i.assignment_id = a.id)
       or (select max(position) <> count(*) from public.assignment_items i where i.assignment_id = a.id)   -- numbered 1..n
       or exists (select 1 from public.assignment_items i left join public.assignment_answer_keys k on k.item_id = i.id
                  where i.assignment_id = a.id and (k.item_id is null or k.answer_index >= cardinality(i.options)))) then
    raise exception 'every quiz question needs a valid answer key';
  end if;
  update public.assignments set status = 'published', published_at = now() where id = a.id;
end $$;

create function public.archive_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.assignments a where a.id = p_assignment and app.teaches_group(a.group_id)) then
    raise exception 'not your assignment' using errcode = '42501'; end if;
  update public.assignments set status = 'archived' where id = p_assignment;
end $$;

-- ---------- student operations ----------
create function app.require_student_on(p_assignment uuid) returns public.assignments
language plpgsql stable security definer set search_path = '' as $$
declare a public.assignments;
begin
  if not app.has_role('student') then raise exception 'students only' using errcode = '42501'; end if;
  if p_assignment is null then return null; end if;
  select * into a from public.assignments where id = p_assignment;
  if a.id is null or a.status <> 'published' or not app.member_of_group(a.group_id)
     or not app.consent_active((select auth.uid()), 'group', a.group_id) then
    raise exception 'assignment not available' using errcode = '42501';
  end if;
  return a;
end $$;

create function public.start_session(p_assignment uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; sid uuid;
begin
  a := app.require_student_on(p_assignment);
  insert into public.learning_sessions (student_id, assignment_id, source) values (auth.uid(), p_assignment, 'player') returning id into sid;
  if p_assignment is not null then
    insert into public.assignment_status (assignment_id, student_id) values (p_assignment, auth.uid())
    on conflict do nothing;
  end if;
  return sid;
end $$;

-- p_events: [{ "id": uuid, "kind": "question"|"round_done", "skill", "topic", "ok": bool, "ms": int }], at most 50
create function public.record_progress(p_session uuid, p_events jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.learning_sessions; e jsonb; n int := 0; added int;
begin
  if not app.has_role('student') then raise exception 'students only' using errcode = '42501'; end if;
  select * into s from public.learning_sessions where id = p_session;
  if s.id is null or s.student_id <> auth.uid() then raise exception 'session not found' using errcode = '42501'; end if;
  if s.ended_at is not null and s.ended_at < now() - interval '1 hour' then raise exception 'session closed'; end if;
  if s.assignment_id is not null then perform app.require_student_on(s.assignment_id); end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then raise exception 'send 1–50 events'; end if;
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

create function public.finish_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.learning_sessions set ended_at = coalesce(ended_at, now())
  where id = p_session and student_id = auth.uid();
  if not found then raise exception 'session not found' using errcode = '42501'; end if;
end $$;

-- graded HERE against keys the student cannot read. At most 3 attempts; the best counts.
create function public.submit_quiz(p_assignment uuid, p_answers int[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.assignments; n_items int; sc int; tries int; late boolean;
begin
  a := app.require_student_on(p_assignment);
  if a.kind <> 'quiz' then raise exception 'not a quiz'; end if;
  select count(*) into n_items from public.assignment_items where assignment_id = a.id;
  if p_answers is null or cardinality(p_answers) <> n_items then raise exception 'answer every question'; end if;
  perform pg_advisory_xact_lock(hashtext('quiz:' || a.id::text || auth.uid()::text));
  select count(*) into tries from public.quiz_attempts where assignment_id = a.id and student_id = auth.uid();
  if tries >= 3 then raise exception 'no attempts left'; end if;
  select count(*) into sc from public.assignment_items i join public.assignment_answer_keys k on k.item_id = i.id
  where i.assignment_id = a.id and p_answers[i.position] = k.answer_index;
  late := a.due_at is not null and current_date > a.due_at;
  insert into public.quiz_attempts (assignment_id, student_id, attempt_no, answers, score, max_score, late)
  values (a.id, auth.uid(), tries + 1, p_answers, sc, n_items, late);
  insert into public.assignment_status (assignment_id, student_id, state, verified_score, verified_max, attempts)
  values (a.id, auth.uid(), 'completed', sc, n_items, 1)
  on conflict (assignment_id, student_id) do update set state = 'completed', attempts = public.assignment_status.attempts + 1,
    verified_score = greatest(coalesce(public.assignment_status.verified_score, 0), excluded.verified_score),
    verified_max = excluded.verified_max, last_activity_at = now();
  return jsonb_build_object('score', sc, 'max', n_items, 'attempt', tries + 1, 'attempts_left', 2 - tries, 'late', late);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.publish_assignment(uuid)', 'public.archive_assignment(uuid)', 'public.start_session(uuid)',
    'public.record_progress(uuid, jsonb)', 'public.finish_session(uuid)', 'public.submit_quiz(uuid, int[])']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.require_student_on(uuid) from public;
grant execute on function app.require_student_on(uuid) to authenticated;

create trigger audit_assignments after insert or update or delete on public.assignments for each row execute function app.audit();
create trigger audit_quiz_attempts after insert on public.quiz_attempts for each row execute function app.audit();
