-- Private profile pictures (infrastructure only – no images are uploaded by this migration).
-- Bucket "avatars" is private: files are reached only through short-lived signed URLs after these checks.
-- Object path: "<owner user id>/<file>", e.g. "3f2c…/face.webp". Max 2 MB; jpeg/png/webp only.
-- Images are never sent to an AI model (enforced in the Edge Functions, which never read this bucket).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and app.can_see_avatar(app.object_owner(name)));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and app.can_manage_avatar(app.object_owner(name)));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and app.can_manage_avatar(app.object_owner(name)))
  with check (bucket_id = 'avatars' and app.can_manage_avatar(app.object_owner(name)));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and app.can_manage_avatar(app.object_owner(name)));
