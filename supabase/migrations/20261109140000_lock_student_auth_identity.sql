-- Found by the local end-to-end tests: with the session it receives, a student could call Supabase Auth
-- `updateUser({ password })` and then sign in to Auth directly – bypassing the PIN, the approved-device rule
-- and the attempt limits. A student could also start an e-mail or phone change (account takeover path).
--
-- Fix: once an auth user is a student, its sign-in identity is frozen. The password (random, set once at
-- creation by the server and never kept), e-mail (an undeliverable .invalid address) and phone can never
-- change again – whoever asks, through whichever API. A student's PIN/password lives in
-- student_credentials and is changed only by a verified parent (srv_set_secret), so nothing legitimate is lost.
-- Compared as jsonb so the function does not depend on the exact auth.users column list.

create function app.freeze_student_auth_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
begin
  if exists (select 1 from public.students s where s.id = old.id) then
    foreach k in array array['encrypted_password', 'email', 'email_change', 'phone', 'phone_change'] loop
      if (o ->> k) is distinct from (n ->> k) then
        raise exception 'a student account''s sign-in identity cannot be changed (%).', k using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger freeze_student_auth_identity before update on auth.users
  for each row execute function app.freeze_student_auth_identity();
