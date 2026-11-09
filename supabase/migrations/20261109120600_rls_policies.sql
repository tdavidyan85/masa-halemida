-- Row Level Security. Supabase grants ALL on public tables to anon and authenticated by default,
-- so every table first loses everything, then gets back only the operations (and columns) it needs.
-- anon (signed-out visitors) gets nothing at all. Writes that need more than a row check go through
-- the SECURITY DEFINER functions in the next migration.

do $$
declare t text;
begin
  foreach t in array array['profiles','user_roles','students','student_credentials','guardianships','groups',
                           'group_teachers','group_members','consents','invitations','learning_materials','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema public from anon;

-- ---------- profiles ----------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_path) on public.profiles to authenticated;   -- never status, never id

create policy profiles_select on public.profiles for select to authenticated
  using (app.can_see_profile(id));
-- an adult edits their own name/picture; a student cannot edit anything
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and app.is_active() and not app.has_role('student'))
  with check (id = (select auth.uid()) and (avatar_path is null or app.object_owner(avatar_path) = id));
-- a parent edits a child's name/picture (a picture only with an active photo consent)
create policy profiles_update_child on public.profiles for update to authenticated
  using (app.is_guardian_of(id))
  with check (app.is_guardian_of(id) and (avatar_path is null or (app.object_owner(avatar_path) = id and app.consent_active(id, 'photo'))));

-- ---------- user_roles: read own; written only by request_role() / admin functions ----------
grant select on public.user_roles to authenticated;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or app.is_admin());

-- ---------- students: birth_date and username are not readable through the API ----------
grant select (id, grade, login_mode, created_at) on public.students to authenticated;
grant update (grade) on public.students to authenticated;
create policy students_select on public.students for select to authenticated
  using (id = (select auth.uid()) or app.is_admin() or app.is_guardian_of(id) or app.teaches_student(id));
create policy students_update_parent on public.students for update to authenticated
  using (app.is_guardian_of(id)) with check (app.is_guardian_of(id));

-- ---------- student_credentials: RLS on, no policy, no grant → server only ----------

-- ---------- guardianships ----------
grant select on public.guardianships to authenticated;
create policy guardianships_select on public.guardianships for select to authenticated
  using (parent_id = (select auth.uid()) or student_id = (select auth.uid()) or app.is_admin());

-- ---------- groups ----------
grant select on public.groups to authenticated;
grant insert (name, subject, grade) on public.groups to authenticated;
grant update (name, subject, grade, archived_at) on public.groups to authenticated;
create policy groups_select on public.groups for select to authenticated
  using (app.can_see_group(id) or (created_by = (select auth.uid()) and app.has_role('teacher')));
create policy groups_insert_teacher on public.groups for insert to authenticated
  with check (app.has_role('teacher') and created_by = (select auth.uid()));
create policy groups_update_owner on public.groups for update to authenticated
  using (app.owns_group(id) or app.is_admin()) with check (app.owns_group(id) or app.is_admin());

-- ---------- group_teachers ----------
grant select on public.group_teachers to authenticated;
grant insert (group_id, teacher_id, role) on public.group_teachers to authenticated;
grant delete on public.group_teachers to authenticated;
create policy group_teachers_select on public.group_teachers for select to authenticated
  using (app.can_see_group(group_id));
-- the owner adds a co-teacher (who must be an approved teacher); nobody adds themselves as owner
create policy group_teachers_insert_owner on public.group_teachers for insert to authenticated
  with check (app.owns_group(group_id) and role = 'co' and app.user_has_role(teacher_id, 'teacher'));
create policy group_teachers_delete on public.group_teachers for delete to authenticated
  using ((app.owns_group(group_id) and role = 'co') or app.is_admin());

-- ---------- group_members: joined only through an approved invitation (respond_invitation) ----------
-- no direct writes: joining = respond_invitation(); a teacher removing a student = remove_member()
-- (an UPDATE must leave the row visible to its author, and removed rows are hidden from teachers on purpose)
grant select on public.group_members to authenticated;
create policy group_members_select on public.group_members for select to authenticated
  using (app.is_admin()
      or student_id = (select auth.uid())
      or app.is_guardian_of(student_id)
      or (app.teaches_group(group_id) and status = 'active' and app.consent_active(student_id, 'group', group_id)));

-- ---------- consents: written only by respond_invitation / grant_consent / revoke_consent ----------
grant select on public.consents to authenticated;
create policy consents_select on public.consents for select to authenticated
  using (guardian_id = (select auth.uid())
      or app.is_guardian_of(student_id)
      or student_id = (select auth.uid())
      or app.is_admin()
      or (scope = 'group' and revoked_at is null and app.teaches_group(group_id)));

-- ---------- invitations: the parent's address hash is not readable ----------
grant select (id, group_id, invited_by, child_hint, status, expires_at, responded_at, created_at) on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (invited_by = (select auth.uid())
      or app.teaches_group(group_id)
      or app.is_admin()
      or (app.has_role('parent') and status = 'pending' and expires_at > now() and contact_hash = app.my_email_hash()));

-- ---------- learning_materials: teachers and parents only ----------
grant select on public.learning_materials to authenticated;
grant insert (title, storage_path) on public.learning_materials to authenticated;
grant update (title, storage_path) on public.learning_materials to authenticated;
grant delete on public.learning_materials to authenticated;
create policy materials_select on public.learning_materials for select to authenticated
  using (owner_id = (select auth.uid()) or app.is_admin());
create policy materials_insert on public.learning_materials for insert to authenticated
  with check (owner_id = (select auth.uid()) and (app.has_role('teacher') or app.has_role('parent')));
create policy materials_update on public.learning_materials for update to authenticated
  using (owner_id = (select auth.uid()) and (app.has_role('teacher') or app.has_role('parent')))
  with check (owner_id = (select auth.uid()));
create policy materials_delete on public.learning_materials for delete to authenticated
  using (owner_id = (select auth.uid()) and (app.has_role('teacher') or app.has_role('parent')));

-- ---------- audit_log: admins read; nobody writes through the API ----------
grant select on public.audit_log to authenticated;
create policy audit_select_admin on public.audit_log for select to authenticated using (app.is_admin());
