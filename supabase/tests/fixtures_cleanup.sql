-- Removes exactly the fictional fixture rows (fixtures.sql) from a shared local database. Nothing else.
-- Groups first (their consents, invitations and memberships go with them), then the users (profiles,
-- roles, students, guardianships, credentials, devices and attempts cascade). audit_log is append-only
-- by design and keeps its rows (they hold ids, never names).
delete from public.groups where id in ('00000000-0000-4000-b000-000000000101', '00000000-0000-4000-b000-000000000102');
delete from auth.users where id in (
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-000000000012',
  '00000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000022',
  '00000000-0000-4000-a000-000000000023', '00000000-0000-4000-a000-000000000031', '00000000-0000-4000-a000-000000000032',
  '00000000-0000-4000-a000-000000000033', '00000000-0000-4000-a000-000000000034');
