-- RLS tests for dcs.mdr_settings (DCS 1a.05), following rls_clients.test.sql:
-- fixtures as postgres inside this transaction (rolled back), then
-- impersonation via authenticated/anon roles + request.jwt.claims.
--
-- Test projects are created here rather than in seed: mdr_settings rows must
-- NOT exist for real projects (a missing row means "DCS does not run this
-- project"), and the CASCADE test deletes its project.
--
-- Section 5 (DCS-1b.19): "Doc controllers manage mdr settings" predates this
-- task (read confirmed identical on scl-dev and prod, 2026-09-25) — these
-- assertions are the first to actually exercise it: a project's own DC can
-- UPDATE its mdr_settings row directly, a DC of a DIFFERENT project cannot,
-- and section 2 above already covers a plain member (tymon, before he is
-- given any dcs.project_roles row in section 5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
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

-- ============================================================
-- 5. DCS-1b.19: a project's own DC updates mdr_settings directly; a DC of a
-- DIFFERENT project is refused (a plain member is already covered by
-- section 2, before tymon holds any project_roles row at all).
-- ============================================================
insert into public.projects (id, name, project_code) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'DCS Test Delta', 'SC9904');
insert into dcs.mdr_settings (project_id, budget_hours)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 200);

-- ernest is Delta's DC; tymon is Alpha's DC — neither is DC of the other's
-- project, which is exactly the case this section proves refused.
insert into dcs.project_roles (project_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', (select ernest_id from t_fixture), 'dc');
insert into dcs.project_roles (project_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', (select employee_id from t_fixture), 'dc');

set local role authenticated;

-- 5a. GREEN: Delta's own DC (ernest) updates its budget and cycle.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text,
  true
);
update dcs.mdr_settings set budget_hours = 300, cycle_ifr_to_retcom = 20
 where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
select results_eq(
  $$select budget_hours, cycle_ifr_to_retcom from dcs.mdr_settings
      where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'$$,
  $$values (300::numeric, 20)$$,
  'GREEN: Delta''s own DC (ernest) updates its budget and cycle'
);

-- 5b. RED: tymon, DC of Alpha, is refused on Delta (another project).
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);
update dcs.mdr_settings set budget_hours = 999
 where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
select is(
  (select budget_hours from dcs.mdr_settings where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
  300::numeric,
  'RED: a DC of another project (tymon on Alpha) cannot update Delta''s settings'
);

-- 5c. RED, the other direction: ernest (Delta's DC only) cannot update Alpha.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text,
  true
);
update dcs.mdr_settings set budget_hours = 999
 where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
select is(
  (select budget_hours from dcs.mdr_settings where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  500::numeric,
  'RED: a DC of another project (ernest on Delta) cannot update Alpha''s settings either'
);

reset role;

select * from finish();
rollback;
