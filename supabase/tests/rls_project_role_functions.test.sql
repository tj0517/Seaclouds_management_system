-- Tests for DCS 1a.09: is_project_member() / has_project_role() /
-- is_doc_controller() and the policies built on them (dcs.project_roles,
-- public.clients, dcs.mdr_settings, public.audit_log). Follows
-- audit_log.test.sql: fixtures as postgres inside this transaction (rolled
-- back), then impersonation via authenticated/anon + request.jwt.claims,
-- exactly like PostgREST.
--
-- Cast (seed + two users created here):
--   admin    tjezionekspam@gmail.com  profiles.role = admin
--   tymon    tjezionek2000@gmail.com  DC of PEJ (role), member of IT (assignment)
--   ernest   ejezionek@gmail.com      member of PEJ via project_assignments ONLY
--   otherdc  created below            DC of IT only (role), nothing on PEJ
--   outsider created below            no assignment, no role anywhere
-- Projects from seed: PEJ = 6c0909ce-…, IT = 094e130b-….
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- ============================================================
-- Schema assertions (red without the migration)
-- ============================================================
select has_function('public', 'is_project_member', array['uuid'], 'is_project_member(uuid) exists');
select has_function('public', 'has_project_role', array['uuid', 'dcs.project_role[]'], 'has_project_role(uuid, dcs.project_role[]) exists');
select has_function('public', 'is_doc_controller', array['uuid'], 'is_doc_controller(uuid) exists');
select is_definer('public', 'is_project_member', array['uuid'], 'is_project_member is SECURITY DEFINER');
select is_definer('public', 'has_project_role', array['uuid', 'dcs.project_role[]'], 'has_project_role is SECURITY DEFINER');
select is_definer('public', 'is_doc_controller', array['uuid'], 'is_doc_controller is SECURITY DEFINER');
select is(
  (select count(*) from pg_proc p
    where p.oid in ('public.is_project_member(uuid)'::regprocedure,
                    'public.has_project_role(uuid, dcs.project_role[])'::regprocedure,
                    'public.is_doc_controller(uuid)'::regprocedure)
      and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=', 'search_path=""'))),
  3::bigint,
  'all three functions have search_path pinned to '''''
);
select ok(has_function_privilege('authenticated', 'public.is_project_member(uuid)', 'execute'),
  'authenticated can execute is_project_member (policies run as the querying role)');
select ok(has_function_privilege('authenticated', 'public.has_project_role(uuid, dcs.project_role[])', 'execute'),
  'authenticated can execute has_project_role');
select ok(has_function_privilege('authenticated', 'public.is_doc_controller(uuid)', 'execute'),
  'authenticated can execute is_doc_controller');
select ok(not has_function_privilege('anon', 'public.is_doc_controller(uuid)', 'execute'),
  'anon cannot execute is_doc_controller');

select policies_are('dcs', 'project_roles',
  array['Project members read project roles', 'Doc controllers manage project roles', 'Admins manage project roles'],
  'project_roles: exactly the three 1a.09 policies');
select policies_are('public', 'clients',
  array['Members of client projects read clients', 'Admins manage clients'],
  'clients: exactly the two 1a.09 policies');
select policies_are('dcs', 'mdr_settings',
  array['Authenticated users can read mdr settings', 'Admins manage mdr settings', 'Doc controllers manage mdr settings'],
  'mdr_settings: the two 1a.05 policies plus the DC policy');
select policies_are('public', 'audit_log',
  array['Admins read audit log', 'Doc controllers read own project audit log'],
  'audit_log: admin policy plus the DC policy; still no write policies');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_log' and cmd <> 'SELECT'),
  0::bigint, 'audit_log still has zero INSERT/UPDATE/DELETE policies');

-- ============================================================
-- Fixtures (as postgres)
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
   'authenticated', 'authenticated', 'otherdc-1a09@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Other DC"}', now(), now(),
   '', '', '', '', '', '', '', 0),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
   'authenticated', 'authenticated', 'outsider-1a09@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Outsider"}', now(), now(),
   '', '', '', '', '', '', '', 0);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid as otherdc_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid as outsider_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid as client_x_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid as client_y_id;
grant select on t_fixture to authenticated;

-- Seed gives: tymon → IT (assignment), ernest → PEJ (assignment), admin → both.
select is(
  (select count(*) from public.project_assignments
    where user_id = (select ernest_id from t_fixture) and project_id = (select pej_id from t_fixture)),
  1::bigint, 'sanity: ernest is assigned to PEJ in seed (member via project_assignments only)');
select is(
  (select count(*) from dcs.project_roles), 0::bigint,
  'sanity: no project roles before the fixtures');

insert into dcs.project_roles (project_id, user_id, role) values
  ((select pej_id from t_fixture), (select tymon_id from t_fixture), 'dc'),
  ((select pej_id from t_fixture), (select tymon_id from t_fixture), 'app'),
  ((select it_id from t_fixture), (select otherdc_id from t_fixture), 'dc');

insert into public.clients (id, name, code) values
  ((select client_x_id from t_fixture), 'Client X (PEJ)', 'CLX'),
  ((select client_y_id from t_fixture), 'Client Y (IT)', 'CLY');
update public.projects set client_id = (select client_x_id from t_fixture) where id = (select pej_id from t_fixture);
update public.projects set client_id = (select client_y_id from t_fixture) where id = (select it_id from t_fixture);

-- ============================================================
-- 1. Function semantics per session
-- ============================================================
set local role authenticated;

-- tymon: DC of PEJ (role), member of IT (assignment)
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(public.is_project_member((select pej_id from t_fixture)), 'tymon: is_project_member(PEJ) via project_roles');
select ok(public.is_project_member((select it_id from t_fixture)), 'tymon: is_project_member(IT) via project_assignments');
select ok(public.has_project_role((select pej_id from t_fixture), array['dc']::dcs.project_role[]), 'tymon: has_project_role(PEJ, {dc})');
select ok(public.has_project_role((select pej_id from t_fixture), array['rev', 'app']::dcs.project_role[]), 'tymon: has_project_role(PEJ, {rev, app}) matches app');
select ok(not public.has_project_role((select pej_id from t_fixture), array['rev', 'chk']::dcs.project_role[]), 'tymon: has_project_role(PEJ, {rev, chk}) is false');
select ok(public.is_doc_controller((select pej_id from t_fixture)), 'tymon: is_doc_controller(PEJ)');
select ok(not public.is_doc_controller((select it_id from t_fixture)), 'tymon: NOT is_doc_controller(IT) (member only)');

-- ernest: PEJ via assignment only
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(public.is_project_member((select pej_id from t_fixture)), 'ernest: is_project_member(PEJ) via project_assignments only');
select ok(not public.is_project_member((select it_id from t_fixture)), 'ernest: NOT is_project_member(IT)');
select ok(not public.is_doc_controller((select pej_id from t_fixture)), 'ernest: NOT is_doc_controller(PEJ)');

-- outsider: nothing anywhere
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(not public.is_project_member((select pej_id from t_fixture)), 'outsider: NOT is_project_member(PEJ)');
select ok(not public.is_project_member((select it_id from t_fixture)), 'outsider: NOT is_project_member(IT)');

-- ============================================================
-- 2. dcs.project_roles
-- ============================================================
-- GREEN: assignment-only member reads every role row of the project
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select is(
  (select count(*) from dcs.project_roles where project_id = (select pej_id from t_fixture)),
  2::bigint, 'project_roles GREEN: ernest (assignment only, no role row) sees both PEJ role rows');
-- RED: not a member of IT → none of its rows
select is(
  (select count(*) from dcs.project_roles where project_id = (select it_id from t_fixture)),
  0::bigint, 'project_roles RED: ernest sees no IT role rows');
-- RED: member but not DC cannot write
select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select pej_id from t_fixture), (select ernest_id from t_fixture), 'rev')$$,
  '42501', null, 'project_roles RED: non-DC member cannot insert a role');

-- RED: outsider sees nothing at all
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from dcs.project_roles), 0::bigint,
  'project_roles RED: outsider (no assignment, no role) sees zero rows');

-- GREEN: DC of PEJ manages PEJ roles without being admin
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select ernest_id from t_fixture), 'rev', (select tymon_id from t_fixture))$$,
  'project_roles GREEN: DC of PEJ grants rev to ernest on PEJ');
update dcs.project_roles set role = 'chk'
 where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture);
select is(
  (select role::text from dcs.project_roles
    where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture)),
  'chk', 'project_roles GREEN: DC of PEJ updates the role (rev → chk)');
delete from dcs.project_roles
 where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture);
select is(
  (select count(*) from dcs.project_roles where user_id = (select ernest_id from t_fixture)),
  0::bigint, 'project_roles GREEN: DC of PEJ revokes the role');
-- RED: DC of PEJ is not DC of IT
select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select it_id from t_fixture), (select ernest_id from t_fixture), 'rev')$$,
  '42501', null, 'project_roles RED: DC of PEJ cannot grant roles on IT');
select is(
  (select count(*) from dcs.project_roles where project_id = (select it_id from t_fixture)),
  1::bigint, 'project_roles GREEN: tymon (IT member via assignment) reads the IT role row');

-- ============================================================
-- 3. public.clients
-- ============================================================
-- GREEN/RED: ernest (PEJ only) sees client X, not client Y
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select is(
  (select count(*) from public.clients where id = (select client_x_id from t_fixture)),
  1::bigint, 'clients GREEN: member of a PEJ (client X) project reads client X');
select is(
  (select count(*) from public.clients where id = (select client_y_id from t_fixture)),
  0::bigint, 'clients RED: ernest has no project tied to client Y → cannot see it');
-- RED: outsider sees no client
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.clients), 0::bigint,
  'clients RED: outsider sees zero clients');
-- RED: a project's DC cannot write clients
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select throws_ok(
  $$insert into public.clients (name, code) values ('DC made me', 'DCX')$$,
  '42501', null, 'clients RED: DC of PEJ cannot insert a client');
update public.clients set name = 'renamed by DC' where id = (select client_x_id from t_fixture);
select is(
  (select name from public.clients where id = (select client_x_id from t_fixture)),
  'Client X (PEJ)', 'clients RED: DC of PEJ update of client X has no effect');
-- GREEN: admin reads all and writes
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.clients), 2::bigint, 'clients GREEN: admin sees both clients');
update public.clients set name = 'Client X (renamed by admin)' where id = (select client_x_id from t_fixture);
select is(
  (select name from public.clients where id = (select client_x_id from t_fixture)),
  'Client X (renamed by admin)', 'clients GREEN: admin update takes effect');

-- ============================================================
-- 4. dcs.mdr_settings (seed has a PEJ row; IT has none yet)
-- ============================================================
-- GREEN: DC of PEJ updates PEJ settings
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
update dcs.mdr_settings set cycle_idc_to_ifr = 9 where project_id = (select pej_id from t_fixture);
select is(
  (select cycle_idc_to_ifr from dcs.mdr_settings where project_id = (select pej_id from t_fixture)),
  9, 'mdr_settings GREEN: DC of PEJ updates cycle_idc_to_ifr');
-- RED: DC of PEJ cannot create settings for IT
select throws_ok(
  $$insert into dcs.mdr_settings (project_id) values ((select it_id from t_fixture))$$,
  '42501', null, 'mdr_settings RED: DC of PEJ cannot insert settings for IT');
-- RED: DC of a different project (IT) cannot touch PEJ
select set_config('request.jwt.claims',
  json_build_object('sub', (select otherdc_id from t_fixture), 'role', 'authenticated')::text, true);
update dcs.mdr_settings set cycle_idc_to_ifr = 11 where project_id = (select pej_id from t_fixture);
select is(
  (select cycle_idc_to_ifr from dcs.mdr_settings where project_id = (select pej_id from t_fixture)),
  9, 'mdr_settings RED: DC of IT update of PEJ settings has no effect');
-- GREEN: DC of IT creates the IT row
select lives_ok(
  $$insert into dcs.mdr_settings (project_id, budget_hours) values ((select it_id from t_fixture), 40)$$,
  'mdr_settings GREEN: DC of IT inserts settings for IT');
-- GREEN (unchanged): non-DC member still reads; RED: cannot write
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from dcs.mdr_settings), 2::bigint,
  'mdr_settings GREEN: non-admin, non-DC user still SELECTs all rows (policy unchanged)');
update dcs.mdr_settings set cycle_idc_to_ifr = 13 where project_id = (select pej_id from t_fixture);
select is(
  (select cycle_idc_to_ifr from dcs.mdr_settings where project_id = (select pej_id from t_fixture)),
  9, 'mdr_settings RED: non-DC member update has no effect');

-- ============================================================
-- 5. public.audit_log (rows produced above by the audit trigger)
-- ============================================================
-- GREEN/RED: DC of PEJ sees only PEJ rows — never IT rows, never NULL-project rows
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select cmp_ok((select count(*) from public.audit_log), '>', 0::bigint,
  'audit_log GREEN: DC of PEJ sees audit rows');
select is(
  (select count(*) from public.audit_log where project_id is distinct from (select pej_id from t_fixture)),
  0::bigint, 'audit_log RED: DC of PEJ sees no rows of other projects and no project_id NULL rows');
select cmp_ok(
  (select count(*) from public.audit_log where table_name = 'dcs.project_roles'), '>=', 3::bigint,
  'audit_log GREEN: the PEJ role grant/update/revoke above is visible to the PEJ DC');
-- GREEN/RED: DC of IT sees only IT rows
select set_config('request.jwt.claims',
  json_build_object('sub', (select otherdc_id from t_fixture), 'role', 'authenticated')::text, true);
select cmp_ok((select count(*) from public.audit_log), '>', 0::bigint,
  'audit_log GREEN: DC of IT sees audit rows (its own mdr_settings insert)');
select is(
  (select count(*) from public.audit_log where project_id is distinct from (select it_id from t_fixture)),
  0::bigint, 'audit_log RED: DC of IT sees no PEJ rows and no NULL-project rows');
-- RED: non-DC member and outsider see nothing
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.audit_log), 0::bigint,
  'audit_log RED: non-DC member sees zero rows');
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.audit_log), 0::bigint,
  'audit_log RED: outsider sees zero rows');
-- GREEN: admin still sees NULL-project rows (profiles/clients edits)
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
select cmp_ok((select count(*) from public.audit_log where project_id is null), '>', 0::bigint,
  'audit_log GREEN: admin sees project_id NULL rows (clients/profiles) — unchanged');
-- RED: writes still impossible even for the admin
select throws_ok(
  $$delete from public.audit_log$$, '42501', null,
  'audit_log RED: admin still cannot delete from the log');

-- ============================================================
-- 6. anon: no function, no table
-- ============================================================
set local role anon;
select throws_ok(
  $$select public.is_doc_controller('6c0909ce-9b74-4bda-8e92-10811ff5a0fc')$$, '42501', null,
  'anon cannot call is_doc_controller (permission denied)');
select throws_ok('select count(*) from dcs.project_roles', '42501', null,
  'anon cannot select from project_roles');
reset role;

select * from finish();
rollback;
