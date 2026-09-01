-- RLS tests for public.clients (DCS 1a.04), following the pattern of
-- rls_timesheet_entries.test.sql: fixture lookups as postgres, then
-- impersonation via `authenticated`/`anon` roles + request.jwt.claims,
-- exactly like PostgREST does.
--
-- Client fixtures are created inside this transaction (rolled back at the
-- end) instead of seed.sql — the task forbids seeding real contractors, and
-- no app flow depends on clients existing yet.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ============================================================
-- Schema assertions (red without the migration)
-- ============================================================
select has_table('public', 'clients', 'table public.clients exists');
select has_column('public', 'projects', 'client_id', 'projects.client_id exists');
select fk_ok(
  'public', 'projects', 'client_id',
  'public', 'clients', 'id',
  'projects.client_id references clients.id'
);

-- ============================================================
-- Fixtures (as postgres, before switching roles).
-- Seed generates user UUIDs at runtime, so look them up by email.
-- ============================================================
insert into public.clients (id, name, code, contact_email, notes)
values
  ('11111111-1111-4111-8111-111111111111', 'Acme Industries', 'ACME', 'contact@acme.example', 'test fixture'),
  ('22222222-2222-4222-8222-222222222222', 'Globex Corporation', 'GLOBEX', null, null);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as employee_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select count(*) from public.clients) as total_clients;
grant select on t_fixture to authenticated;

select cmp_ok(
  (select total_clients from t_fixture), '>=', 2::bigint,
  'sanity: client fixtures are in place'
);

-- ============================================================
-- 1. Anon (signed out) cannot read clients at all
-- (no grants for anon — migration 20260831143841 revoked them and the
-- default privileges; RLS is the second line, grants are the first)
-- ============================================================
set local role anon;

select throws_ok(
  'select count(*) from public.clients',
  '42501',
  null,
  'anon cannot select from clients (permission denied)'
);

reset role;

-- ============================================================
-- 2. Signed-in employee sees all clients, but cannot write
-- ============================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*) from public.clients),
  (select total_clients from t_fixture),
  'employee sees all clients'
);

select throws_ok(
  $$insert into public.clients (name, code) values ('Sneaky Ltd', 'SNEAKY')$$,
  '42501',
  'new row violates row-level security policy for table "clients"',
  'employee cannot insert a client'
);

-- Data-modifying CTEs cannot be subqueries, so run the write top-level
-- (silently matches zero rows under RLS) and assert the state afterwards.
update public.clients set name = 'Hacked'
 where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select name from public.clients where id = '11111111-1111-4111-8111-111111111111'),
  'Acme Industries',
  'employee update has no effect'
);

delete from public.clients
 where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select count(*) from public.clients where id = '11111111-1111-4111-8111-111111111111'),
  1::bigint,
  'employee delete has no effect'
);

-- ============================================================
-- 3. Admin can insert, update and delete
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$insert into public.clients (id, name, code)
    values ('33333333-3333-4333-8333-333333333333', 'Initech', 'INITECH')$$,
  'admin can insert a client'
);

update public.clients set contact_email = 'office@initech.example'
 where id = '33333333-3333-4333-8333-333333333333';
select is(
  (select contact_email from public.clients where id = '33333333-3333-4333-8333-333333333333'),
  'office@initech.example',
  'admin update takes effect'
);

delete from public.clients
 where id = '33333333-3333-4333-8333-333333333333';
select is(
  (select count(*) from public.clients where id = '33333333-3333-4333-8333-333333333333'),
  0::bigint,
  'admin can delete a client without projects'
);

select * from finish();
rollback;
