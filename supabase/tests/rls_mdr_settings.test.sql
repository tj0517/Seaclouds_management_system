-- RLS tests for dcs.mdr_settings (DCS 1a.05), following rls_clients.test.sql:
-- fixtures as postgres inside this transaction (rolled back), then
-- impersonation via authenticated/anon roles + request.jwt.claims.
--
-- Test projects are created here rather than in seed: mdr_settings rows must
-- NOT exist for real projects (a missing row means "DCS does not run this
-- project"), and the CASCADE test deletes its project.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ============================================================
-- Schema assertions (red without the migrations)
-- ============================================================
select has_table('dcs', 'mdr_settings', 'table dcs.mdr_settings exists');
select has_trigger('dcs', 'mdr_settings', 'set_updated_at', 'updated_at trigger is attached');

-- ============================================================
-- Fixtures (as postgres, before switching roles).
-- SC99xx codes match the ^SC\d{4}$ CHECK and collide with nothing in seed.
-- ============================================================
insert into public.projects (id, name, project_code) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'DCS Test Alpha', 'SC9901'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'DCS Test Beta', 'SC9902'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'DCS Test Gamma', 'SC9903');

insert into dcs.mdr_settings (project_id, budget_hours)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 500);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as employee_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select count(*) from dcs.mdr_settings) as total_settings;
grant select on t_fixture to authenticated;

select cmp_ok(
  (select total_settings from t_fixture), '>=', 1::bigint,
  'sanity: mdr_settings fixture is in place'
);

-- ============================================================
-- 1. Anon (signed out) cannot read mdr_settings at all
-- (no grants: migration 20260902114742 gave the dcs schema and its default
-- privileges to authenticated/service_role only)
-- ============================================================
set local role anon;

select throws_ok(
  'select count(*) from dcs.mdr_settings',
  '42501',
  null,
  'anon cannot select from mdr_settings (permission denied)'
);

reset role;

-- ============================================================
-- 2. Signed-in employee sees settings, but cannot write
-- ============================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*) from dcs.mdr_settings),
  (select total_settings from t_fixture),
  'employee sees mdr settings'
);

select throws_ok(
  $$insert into dcs.mdr_settings (project_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$$,
  '42501',
  'new row violates row-level security policy for table "mdr_settings"',
  'employee cannot insert mdr settings'
);

-- Data-modifying CTEs cannot be subqueries, so run the write top-level
-- (silently matches zero rows under RLS) and assert the state afterwards.
update dcs.mdr_settings set budget_hours = 0
 where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
select is(
  (select budget_hours from dcs.mdr_settings
    where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  500::numeric,
  'employee update has no effect'
);

delete from dcs.mdr_settings
 where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
select is(
  (select count(*) from dcs.mdr_settings
    where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1::bigint,
  'employee delete has no effect'
);

-- ============================================================
-- 3. Admin can insert and update; CHECKs still apply to admin
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$insert into dcs.mdr_settings (project_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$$,
  'admin can insert mdr settings'
);

update dcs.mdr_settings set cycle_ifr_to_retcom = 14
 where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
select is(
  (select cycle_ifr_to_retcom from dcs.mdr_settings
    where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  14,
  'admin update takes effect'
);

select throws_ok(
  $$insert into dcs.mdr_settings (project_id, cycle_idc_to_ifr)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 0)$$,
  '23514',
  null,
  'CHECK rejects a zero-day cycle'
);

select throws_ok(
  $$insert into dcs.mdr_settings (project_id, budget_hours)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', -1)$$,
  '23514',
  null,
  'CHECK rejects a negative budget'
);

reset role;

-- ============================================================
-- 4. ON DELETE CASCADE: settings vanish with their project
-- ============================================================
delete from public.projects
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
select is(
  (select count(*) from dcs.mdr_settings
    where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  0::bigint,
  'deleting a project cascades to its mdr settings'
);

select * from finish();
rollback;
