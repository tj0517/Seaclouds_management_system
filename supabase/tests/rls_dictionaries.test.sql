-- Tests for DCS 1a.07: dcs.dictionaries — shape, constraints, RLS and the
-- audit trigger. Follows rls_project_role_functions.test.sql: fixtures as
-- postgres inside this transaction (rolled back), then impersonation via
-- authenticated/anon + request.jwt.claims, exactly like PostgREST.
--
-- Cast (seed + one user created here):
--   admin    tjezionekspam@gmail.com  profiles.role = admin
--   tymon    tjezionek2000@gmail.com  DC of PEJ (role row inserted below)
--   ernest   ejezionek@gmail.com      plain employee, no DCS role anywhere
--   outsider created below            no assignment, no role anywhere
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- ============================================================
-- Schema assertions (red without the migration)
-- ============================================================
select has_table('dcs', 'dictionaries', 'table dcs.dictionaries exists');
select columns_are('dcs', 'dictionaries',
  array['id', 'dict_type', 'code', 'label', 'description', 'meta', 'sort_order',
        'is_active', 'created_at', 'updated_at'],
  'dictionaries: exactly the 1a.07 columns (no project_id — company-wide)');
select col_type_is('dcs', 'dictionaries', 'dict_type', 'text',
  'dict_type is text (CHECK, not an enum)');
select col_type_is('dcs', 'dictionaries', 'meta', 'jsonb', 'meta is jsonb');
select col_default_is('dcs', 'dictionaries', 'is_active', 'true', 'is_active defaults to true');
select col_is_pk('dcs', 'dictionaries', 'id', 'id is the primary key (audit_trigger requires it)');
select col_is_unique('dcs', 'dictionaries', array['dict_type', 'code'], '(dict_type, code) is unique');
select has_check('dcs', 'dictionaries', 'dictionaries has a CHECK constraint');
select is(
  (select count(*) from pg_indexes
    where schemaname = 'dcs' and tablename = 'dictionaries'
      and indexdef like '%(dict_type, sort_order)%' and indexdef like '%WHERE is_active%'),
  1::bigint, 'partial index on (dict_type, sort_order) WHERE is_active exists');

select has_trigger('dcs', 'dictionaries', 'audit_dictionaries', 'audit_dictionaries trigger is attached');
select has_trigger('dcs', 'dictionaries', 'set_updated_at', 'set_updated_at trigger is attached');
select is(
  (select tgfoid::regproc::text from pg_trigger
    where tgrelid = 'dcs.dictionaries'::regclass and tgname = 'audit_dictionaries'),
  'audit_trigger', 'audit_dictionaries executes public.audit_trigger()');

select policies_are('dcs', 'dictionaries',
  array['Authenticated users can read dictionaries', 'Admins manage dictionaries'],
  'dictionaries: exactly the two 1a.07 policies');
select is(
  (select count(*) from pg_policies
    where schemaname = 'dcs' and tablename = 'dictionaries' and cmd = 'ALL'
      and qual like '%is_admin()%' and with_check like '%is_admin()%'),
  1::bigint, 'the write policy is gated on is_admin() (USING and WITH CHECK)');

-- ============================================================
-- Fixtures (as postgres)
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
   'authenticated', 'authenticated', 'outsider-1a07@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Outsider"}', now(), now(),
   '', '', '', '', '', '', '', 0);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid as outsider_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid as active_id,
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid as inactive_id;
grant select on t_fixture to authenticated;

select is((select count(*) from dcs.dictionaries), 0::bigint,
  'sanity: the table is empty (content is seeded by 1a.18)');

-- tymon becomes DC of PEJ — a DC, but never an admin.
insert into dcs.project_roles (project_id, user_id, role)
values ((select pej_id from t_fixture), (select tymon_id from t_fixture), 'dc');

-- Two entries, one of them inactive, written as postgres so the RLS sections
-- start from a known state.
insert into dcs.dictionaries (id, dict_type, code, label, sort_order, is_active, meta) values
  ((select active_id from t_fixture), 'discipline', 'PR', 'Process', 10, true, '{}'),
  ((select inactive_id from t_fixture), 'discipline', 'OLD', 'Retired discipline', 20, false, '{"retired": true}');

-- ============================================================
-- 1. Constraints (as postgres — RLS is not what is being tested here)
-- ============================================================
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('discipline', 'PR', 'Duplicate')$$,
  '23505', null, 'RED: duplicate (dict_type, code) is rejected (23505)');
select lives_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('area', 'PR', 'Same code, other type')$$,
  'GREEN: the same code under another dict_type is fine');
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('colour', 'RED', 'Not a dictionary')$$,
  '23514', null, 'RED: dict_type outside the CHECK list is rejected (23514)');
-- All seven dictionary types, one INSERT each. The list below is pinned on
-- purpose: it is the same list as DICT_TYPES in apps/dcs/lib/dictionaries.ts
-- (scripts/check-dict-types.sh compares TS ↔ CHECK in CI); here the CHECK
-- itself is pinned so a migration widening or narrowing it fails this test.
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('doc_type', 'T', 't')$$,
  'GREEN: dict_type doc_type is accepted');
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('discipline', 'T', 't')$$,
  'GREEN: dict_type discipline is accepted');
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('area', 'T', 't')$$,
  'GREEN: dict_type area is accepted');
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('language', 'T', 't')$$,
  'GREEN: dict_type language is accepted');
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('acceptance_code', 'T', 't')$$,
  'GREEN: dict_type acceptance_code is accepted');
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('workflow_status', 'T', 't')$$,
  'GREEN: dict_type workflow_status is accepted');
select lives_ok($$insert into dcs.dictionaries (dict_type, code, label) values ('workflow_step', 'T', 't')$$,
  'GREEN: dict_type workflow_step is accepted');
select bag_eq(
  $$select m[1] from pg_constraint c
     cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
    where c.conrelid = 'dcs.dictionaries'::regclass and c.contype = 'c'$$,
  $$values ('doc_type'), ('discipline'), ('area'), ('language'),
           ('acceptance_code'), ('workflow_status'), ('workflow_step')$$,
  'the dict_type CHECK accepts exactly these seven values (pinned; mirror of DICT_TYPES)');
delete from dcs.dictionaries where code = 'T' or (dict_type = 'area' and code = 'PR');

-- ============================================================
-- 2. anon: nothing
-- ============================================================
set local role anon;
select throws_ok('select count(*) from dcs.dictionaries', '42501', null,
  'RED: anon cannot select from dictionaries (no grants)');
reset role;

-- ============================================================
-- 3. Plain employee (ernest): reads everything, writes nothing
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);

select is((select count(*) from dcs.dictionaries), 2::bigint,
  'GREEN: employee reads both rows');
select is(
  (select is_active from dcs.dictionaries where id = (select inactive_id from t_fixture)),
  false, 'GREEN: the inactive row is still returned to a plain employee (deactivation hides in forms, not in the database)');
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('discipline', 'EL', 'Electrical')$$,
  '42501', null, 'RED: employee INSERT is rejected (42501)');
update dcs.dictionaries set label = 'hacked' where id = (select active_id from t_fixture);
select is(
  (select label from dcs.dictionaries where id = (select active_id from t_fixture)),
  'Process', 'RED: employee UPDATE affects zero rows');
delete from dcs.dictionaries where id = (select active_id from t_fixture);
select is((select count(*) from dcs.dictionaries where id = (select active_id from t_fixture)), 1::bigint,
  'RED: employee DELETE affects zero rows');

-- ============================================================
-- 4. Outsider (no assignment, no role): dictionaries are company-wide
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from dcs.dictionaries), 2::bigint,
  'GREEN: a signed-in user without any project still reads dictionaries');
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('discipline', 'EL', 'Electrical')$$,
  '42501', null, 'RED: outsider INSERT is rejected (42501)');

-- ============================================================
-- 5. DC (tymon, dc on PEJ): reads, but writes are admin-only until 1a.15
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(public.is_doc_controller((select pej_id from t_fixture)),
  'sanity: tymon is a DC (of PEJ) in this session');
select is((select count(*) from dcs.dictionaries), 2::bigint, 'GREEN: DC reads both rows');
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('discipline', 'EL', 'Electrical')$$,
  '42501', null, 'RED: DC INSERT is rejected (42501) — writes are admin-only until 1a.15');
update dcs.dictionaries set label = 'renamed by DC' where id = (select active_id from t_fixture);
select is(
  (select label from dcs.dictionaries where id = (select active_id from t_fixture)),
  'Process', 'RED: DC UPDATE affects zero rows');
update dcs.dictionaries set is_active = true where id = (select inactive_id from t_fixture);
select is(
  (select is_active from dcs.dictionaries where id = (select inactive_id from t_fixture)),
  false, 'RED: DC cannot reactivate an entry either');

-- ============================================================
-- 6. Admin: full write access, every write lands in audit_log
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);

-- The constraint section above produced INSERT+DELETE pairs of its own;
-- count only the two live fixture ids.
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.dictionaries' and action = 'INSERT'
      and record_id in ((select active_id from t_fixture), (select inactive_id from t_fixture))),
  2::bigint, 'sanity: both fixture rows have an INSERT audit entry');

select lives_ok(
  $$insert into dcs.dictionaries (id, dict_type, code, label, sort_order)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'discipline', 'EL', 'Electrical', 30)$$,
  'GREEN: admin INSERT succeeds');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.dictionaries' and action = 'INSERT'
      and record_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'
      and user_id = (select admin_id from t_fixture) and project_id is null),
  1::bigint, 'GREEN: admin INSERT produced one audit row (user_id = admin, project_id NULL)');

update dcs.dictionaries set label = 'Electrical & Instrumentation', sort_order = 35
 where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
select is(
  (select label from dcs.dictionaries where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'),
  'Electrical & Instrumentation', 'GREEN: admin UPDATE takes effect');
select bag_eq(
  $$select field_name from public.audit_log
     where table_name = 'dcs.dictionaries' and action = 'UPDATE'
       and record_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'$$,
  $$values ('label'), ('sort_order')$$,
  'GREEN: admin UPDATE produced one audit row per changed column (updated_at excluded)');

update dcs.dictionaries set is_active = false where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
select is(
  (select new_value from public.audit_log
    where table_name = 'dcs.dictionaries' and action = 'UPDATE'
      and record_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3' and field_name = 'is_active'),
  'false'::jsonb, 'GREEN: deactivation by admin is audited (is_active true → false)');

delete from dcs.dictionaries where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
select is((select count(*) from dcs.dictionaries where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'), 0::bigint,
  'GREEN: admin DELETE takes effect');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.dictionaries' and action = 'DELETE'
      and record_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'
      and old_value ->> 'code' = 'EL'),
  1::bigint, 'GREEN: admin DELETE produced one audit row carrying the old record');

select is((select count(*) from dcs.dictionaries), 2::bigint,
  'GREEN: admin still sees both fixture rows (inactive one included)');

select * from finish();
rollback;
