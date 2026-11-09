-- An invited parent must see WHICH group they are invited to (name, subject, grade, teachers) to decide.
-- Only while the invitation is pending, not expired, and addressed to the parent's confirmed e-mail.
-- It does not show the group's students: group_members still requires teacher/guardian/self.

create or replace function app.can_see_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin() or app.teaches_group(p_group) or app.member_of_group(p_group) or app.child_in_group(p_group)
      or (app.has_role('parent') and exists (
            select 1 from public.invitations i
            where i.group_id = p_group and i.status = 'pending' and i.expires_at > now()
              and i.contact_hash = app.my_email_hash()))
$$;
