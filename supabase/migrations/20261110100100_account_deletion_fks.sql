-- Found while cleaning up after a local end-to-end run: an adult's account could not be deleted once they had
-- granted a role, created a child, opened a group, invited someone, approved a device or made an assignment –
-- several references to profiles had no ON DELETE rule. Deleting an account (e.g. on request) must work.
-- Records that matter keep existing; only the pointer to the deleted person is cleared.

alter table public.user_roles drop constraint user_roles_granted_by_fkey,
  add constraint user_roles_granted_by_fkey foreign key (granted_by) references public.profiles (id) on delete set null;
alter table public.students drop constraint students_created_by_fkey,
  add constraint students_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;
alter table public.groups alter column created_by drop not null,
  drop constraint groups_created_by_fkey,
  add constraint groups_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;
-- invitations of a deleted teacher are meaningless: they go
alter table public.invitations drop constraint invitations_invited_by_fkey,
  add constraint invitations_invited_by_fkey foreign key (invited_by) references public.profiles (id) on delete cascade;
-- a consent stays on record (who gave it is cleared); a revocation stays a revocation
alter table public.consents alter column guardian_id drop not null,
  drop constraint consents_guardian_id_fkey,
  add constraint consents_guardian_id_fkey foreign key (guardian_id) references public.profiles (id) on delete set null,
  drop constraint consents_revoked_by_fkey,
  add constraint consents_revoked_by_fkey foreign key (revoked_by) references public.profiles (id) on delete set null;
alter table public.student_devices alter column enrolled_by drop not null,
  drop constraint student_devices_enrolled_by_fkey,
  add constraint student_devices_enrolled_by_fkey foreign key (enrolled_by) references public.profiles (id) on delete set null;
alter table public.assignments alter column created_by drop not null,
  drop constraint assignments_created_by_fkey,
  add constraint assignments_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;
