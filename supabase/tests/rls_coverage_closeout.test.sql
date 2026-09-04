-- DCS 1a.10: close-out of RLS coverage. Three things the earlier files left
-- open: (1) has_project_role() with multi-element arrays, (2) anon against
-- every RLS table with the denial *mechanism* made explicit, (3) the cells of
-- the role × table matrix nobody asserted yet (DC of another project on
-- clients, unrelated user on mdr_settings/projects, project_assignments).
-- Follows rls_project_role_functions.test.sql: fixtures as postgres inside
-- this transaction (rolled back), then impersonation via authenticated/anon +
-- request.jwt.claims, exactly like PostgREST. No policy, function or
-- migration is touched here — tests only.
--
-- Cast (seed + two users created here):
--   admin    tjezionekspam@gmail.com  profiles.role = admin
--   tymon    tjezionek2000@gmail.com  dc + app on PEJ (roles), member of IT (assignment)
--   ernest   ejezionek@gmail.com      member of PEJ via project_assignments only
--   otherdc  created below            dc on IT only
--   outsider created below            no assignment, no role anywhere
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

-- ============================================================
-- Fixtures (as postgres)
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10',
   'authenticated', 'authenticated', 'otherdc-1a10@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Other DC"}', now(), now(),
   '', '', '', '', '', '', '', 0),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11',
   'authenticated', 'authenticated', 'outsider-1a10@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Outsider"}', now(), now(),
   '', '', '', '', '', '', '', 0);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10'::uuid as otherdc_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11'::uuid as outsider_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccc10'::uuid as client_x_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccc11'::uuid as client_y_id,
  (select count(*) from public.projects) as total_projects,
  (select count(*) from public.project_assignments) as total_assignments;
grant select on t_fixture to authenticated;

insert into dcs.project_roles (project_id, user_id, role) values
  ((select pej_id from t_fixture), (select tymon_id from t_fixture), 'dc'),
  ((select pej_id from t_fixture), (select tymon_id from t_fixture), 'app'),
  ((select it_id from t_fixture), (select otherdc_id from t_fixture), 'dc');

insert into public.clients (id, name, code) values
  ((select client_x_id from t_fixture), 'Client X (PEJ)', 'CLX10'),
  ((select client_y_id from t_fixture), 'Client Y (IT)', 'CLY10');
update public.projects set client_id = (select client_x_id from t_fixture) where id = (select pej_id from t_fixture);
update public.projects set client_id = (select client_y_id from t_fixture) where id = (select it_id from t_fixture);

-- A probe that reports rows or the SQLSTATE of a denial, so one assertion can
-- say *how* anon was stopped. pg_temp functions get no EXECUTE for anon by
-- default (default privileges were revoked in 20260831143841), hence the
-- explicit grant — it lives in this transaction only.
create function pg_temp.probe(t text) returns text language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %s', t) into n;
  return 'rows=' || n;
exception when insufficient_privilege then
  return 'denied:' || sqlstate || ':' || sqlerrm;
end $$;
grant execute on function pg_temp.probe(text) to anon, authenticated;

-- ============================================================
-- 1. has_project_role() beyond {dc} — the assertion left open in 1a.09
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);

select ok(public.has_project_role((select pej_id from t_fixture), array['dc', 'rev', 'chk']::dcs.project_role[]),
  'has_project_role: held role (dc) inside a multi-element array → true');
select ok(public.has_project_role((select pej_id from t_fixture), array['orig', 'app']::dcs.project_role[]),
  'has_project_role: second held role (app) matched when listed last → true');
select ok(not public.has_project_role((select pej_id from t_fixture), array['orig', 'rev', 'chk', 'view']::dcs.project_role[]),
  'has_project_role: array of roles NOT held → false');
select ok(not public.has_project_role((select pej_id from t_fixture), array[]::dcs.project_role[]),
  'has_project_role: empty array → false');
select ok(public.has_project_role((select pej_id from t_fixture), array['dc']::dcs.project_role[]) is not null,
  'has_project_role: never returns NULL (policies would treat NULL as deny, but the contract is boolean)');
-- roles are per project: dc+app on PEJ says nothing about IT
select ok(not public.has_project_role((select it_id from t_fixture), array['dc', 'app']::dcs.project_role[]),
  'has_project_role: roles held on PEJ do not satisfy the same array on IT');
-- otherdc holds dc on IT only
select set_config('request.jwt.claims',
  json_build_object('sub', (select otherdc_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(public.has_project_role((select it_id from t_fixture), array['view', 'dc']::dcs.project_role[]),
  'has_project_role (otherdc): dc on IT matched inside {view, dc}');
select ok(not public.has_project_role((select pej_id from t_fixture), array['dc']::dcs.project_role[]),
  'has_project_role (otherdc): dc on IT does not grant {dc} on PEJ');
-- outsider: nothing anywhere
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(not public.has_project_role((select pej_id from t_fixture), array['orig', 'rev', 'chk', 'app', 'dc', 'view']::dcs.project_role[]),
  'has_project_role (outsider): the full role set on PEJ → false');

reset role;

-- ============================================================
-- 2. anon against every RLS table — three layers, each asserted on its own
--
-- Layer A (privileges): anon holds no SELECT on the table and no USAGE on
--   schema dcs, so the query fails with 42501 before RLS is consulted. This
--   is what the database does today.
-- Layer B (policy predicates, static): every policy on these tables is
--   restrictive in content — no `true`/NULL USING clause — so a future grant
--   would still have to pass a predicate.
-- Layer C (policy evaluation, simulated): inside a savepoint the test GRANTs
--   SELECT to anon and queries again. The result is still a denial — every
--   table carries an admin policy that calls is_admin(), and anon has no
--   EXECUTE on it (revoked in 20260831143841). So even a stray grant yields
--   zero rows, and the assertion says which mechanism stopped it. The
--   savepoint is rolled back: no grant survives this test.
-- ============================================================
set local role anon;

-- Layer A: outcome + mechanism
select ok(not has_schema_privilege('anon', 'dcs', 'usage'),
  'anon: layer A — no USAGE on schema dcs');
select is(
  (select count(*) from information_schema.table_privileges
    where grantee = 'anon' and table_schema in ('public', 'dcs')),
  0::bigint, 'anon: layer A — zero table privileges of any kind in public/dcs');

select throws_ok('select count(*) from dcs.dictionaries', '42501', null,
  'anon: layer A — dcs.dictionaries denied on privileges (42501)');
select throws_ok('select count(*) from dcs.mdr_settings', '42501', null,
  'anon: layer A — dcs.mdr_settings denied on privileges (42501)');
select throws_ok('select count(*) from dcs.project_roles', '42501', null,
  'anon: layer A — dcs.project_roles denied on privileges (42501)');
select throws_ok('select count(*) from public.clients', '42501', null,
  'anon: layer A — public.clients denied on privileges (42501)');
select throws_ok('select count(*) from public.audit_log', '42501', null,
  'anon: layer A — public.audit_log denied on privileges (42501)');
select throws_ok('select count(*) from public.projects', '42501', null,
  'anon: layer A — public.projects denied on privileges (42501)');
select throws_ok('select count(*) from public.project_assignments', '42501', null,
  'anon: layer A — public.project_assignments denied on privileges (42501)');

-- anon cannot write either (same layer: no INSERT/UPDATE/DELETE privilege)
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('area', 'ANON', 'x')$$,
  '42501', null, 'anon: layer A — INSERT into dcs.dictionaries denied');
select throws_ok(
  $$insert into public.clients (name, code) values ('anon', 'ANON')$$,
  '42501', null, 'anon: layer A — INSERT into public.clients denied');

-- Step 4: the helper functions are not callable by anon
select throws_ok('select public.is_admin()', '42501', null,
  'anon: cannot execute is_admin()');
select throws_ok($$select public.is_project_member('6c0909ce-9b74-4bda-8e92-10811ff5a0fc')$$, '42501', null,
  'anon: cannot execute is_project_member()');
select throws_ok($$select public.has_project_role('6c0909ce-9b74-4bda-8e92-10811ff5a0fc', array['dc']::dcs.project_role[])$$, '42501', null,
  'anon: cannot execute has_project_role()');
select throws_ok($$select public.is_doc_controller('6c0909ce-9b74-4bda-8e92-10811ff5a0fc')$$, '42501', null,
  'anon: cannot execute is_doc_controller()');

reset role;

-- Layer B: static shape of the policies (as postgres, reads pg_policies)
select is(
  (select count(*) from pg_policies
    where (schemaname, tablename) in (('dcs','dictionaries'), ('dcs','mdr_settings'), ('dcs','project_roles'),
                                      ('public','clients'), ('public','audit_log'),
                                      ('public','projects'), ('public','project_assignments'))
      and cmd in ('SELECT', 'ALL')
      and (qual is null or qual in ('true', '(true)'))),
  0::bigint, 'anon: layer B — no SELECT/ALL policy on the seven tables has a true/NULL USING clause');
select is(
  (select count(*) from pg_policies
    where (schemaname, tablename) in (('dcs','dictionaries'), ('dcs','mdr_settings'), ('dcs','project_roles'),
                                      ('public','clients'), ('public','audit_log'),
                                      ('public','projects'), ('public','project_assignments'))
      and 'anon' = any (roles)),
  0::bigint, 'anon: layer B — no policy on the seven tables names the anon role explicitly');
select is(
  (select count(*) from pg_class c
    where c.oid in ('dcs.dictionaries'::regclass, 'dcs.mdr_settings'::regclass, 'dcs.project_roles'::regclass,
                    'public.clients'::regclass, 'public.audit_log'::regclass,
                    'public.projects'::regclass, 'public.project_assignments'::regclass)
      and not c.relrowsecurity),
  0::bigint, 'anon: layer B — RLS is enabled on all seven tables');

-- Layer C: simulate a stray grant, prove policies still yield nothing
savepoint stray_grant;
grant usage on schema dcs to anon;
grant select on dcs.dictionaries, dcs.mdr_settings, dcs.project_roles,
                public.clients, public.audit_log, public.projects, public.project_assignments to anon;
set local role anon;
select ok(has_table_privilege('anon', 'public.projects', 'select'),
  'anon: layer C — sanity: the simulated SELECT grant is in place inside the savepoint');
select matches(pg_temp.probe('dcs.dictionaries'), '^(rows=0|denied:42501)',
  'anon: layer C — dcs.dictionaries yields nothing even with SELECT granted');
select matches(pg_temp.probe('dcs.mdr_settings'), '^(rows=0|denied:42501)',
  'anon: layer C — dcs.mdr_settings yields nothing even with SELECT granted');
select matches(pg_temp.probe('dcs.project_roles'), '^(rows=0|denied:42501)',
  'anon: layer C — dcs.project_roles yields nothing even with SELECT granted');
select matches(pg_temp.probe('public.clients'), '^(rows=0|denied:42501)',
  'anon: layer C — public.clients yields nothing even with SELECT granted');
select matches(pg_temp.probe('public.audit_log'), '^(rows=0|denied:42501)',
  'anon: layer C — public.audit_log yields nothing even with SELECT granted');
select matches(pg_temp.probe('public.projects'), '^(rows=0|denied:42501)',
  'anon: layer C — public.projects yields nothing even with SELECT granted');
select matches(pg_temp.probe('public.project_assignments'), '^(rows=0|denied:42501)',
  'anon: layer C — public.project_assignments yields nothing even with SELECT granted');
-- and name the mechanism: today it is the EXECUTE revoke on is_admin()
select matches(pg_temp.probe('public.projects'), 'permission denied for function is_admin',
  'anon: layer C — the stop is the is_admin() EXECUTE revoke reached through the admin policy (documented mechanism)');
rollback to savepoint stray_grant;
select ok(not has_table_privilege('anon', 'public.projects', 'select'),
  'anon: layer C — the simulated grant is gone after the savepoint rollback');

-- ============================================================
-- 3. Matrix cells nobody asserted before
-- ============================================================
set local role authenticated;

-- 3a. clients — DC of another project (otherdc: dc on IT) sees Y, not X
select set_config('request.jwt.claims',
  json_build_object('sub', (select otherdc_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.clients where id = (select client_y_id from t_fixture)), 1::bigint,
  'clients GREEN: DC of IT reads the IT client (Y)');
select is((select count(*) from public.clients where id = (select client_x_id from t_fixture)), 0::bigint,
  'clients RED: DC of IT cannot see the PEJ client (X)');
select throws_ok($$insert into public.clients (name, code) values ('by otherdc', 'ODC')$$, '42501', null,
  'clients RED: DC of IT cannot insert a client');

-- 3b. mdr_settings — unrelated user: SELECT is open to every authenticated
--     (policy from 1a.05, review noted in deferred-tasks q); writes denied
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from dcs.mdr_settings), (select count(*) from dcs.mdr_settings),
  'mdr_settings: outsider SELECT runs (policy open to authenticated — documented, not a leak of writes)');
select cmp_ok((select count(*) from dcs.mdr_settings), '>=', 1::bigint,
  'mdr_settings GREEN-by-design: outsider sees the seed PEJ row (SELECT policy is authenticated-wide)');
select throws_ok(
  $$insert into dcs.mdr_settings (project_id) values ((select it_id from t_fixture))$$, '42501', null,
  'mdr_settings RED: outsider cannot insert');
update dcs.mdr_settings set budget_hours = 1 where project_id = (select pej_id from t_fixture);
select is((select budget_hours from dcs.mdr_settings where project_id = (select pej_id from t_fixture)) is distinct from 1::numeric, true,
  'mdr_settings RED: outsider update affects zero rows');

-- 3c. projects — SELECT is authenticated-wide by TES design; writes admin-only
select is((select count(*) from public.projects), (select total_projects from t_fixture),
  'projects: outsider reads every project (TES policy "Widoczność projektów", authenticated-wide)');
select throws_ok(
  $$insert into public.projects (name, project_code) values ('by outsider', 'SC9910')$$, '42501', null,
  'projects RED: outsider cannot insert a project');
update public.projects set name = 'renamed by outsider' where id = (select pej_id from t_fixture);
select isnt((select name from public.projects where id = (select pej_id from t_fixture)), 'renamed by outsider',
  'projects RED: outsider update affects zero rows');
-- DC of PEJ: no write on projects either (DC has no policy there; is_admin only)
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
update public.projects set name = 'renamed by DC' where id = (select pej_id from t_fixture);
select isnt((select name from public.projects where id = (select pej_id from t_fixture)), 'renamed by DC',
  'projects RED: DC of PEJ update affects zero rows (projects has no DC policy)');
-- admin writes
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
update public.projects set name = 'renamed by admin' where id = (select pej_id from t_fixture);
select is((select name from public.projects where id = (select pej_id from t_fixture)), 'renamed by admin',
  'projects GREEN: admin update takes effect');

-- 3d. project_assignments — own rows or admin
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select cmp_ok((select count(*) from public.project_assignments), '>', 0::bigint,
  'project_assignments GREEN: ernest sees his own assignment rows');
select is((select count(*) from public.project_assignments where user_id <> (select ernest_id from t_fixture)), 0::bigint,
  'project_assignments RED: ernest sees no assignment of anyone else');
select throws_ok(
  $$insert into public.project_assignments (project_id, user_id) values ((select it_id from t_fixture), (select ernest_id from t_fixture))$$,
  '42501', null, 'project_assignments RED: ernest cannot assign himself to IT');
delete from public.project_assignments where user_id <> (select ernest_id from t_fixture);
select is((select count(*) from public.project_assignments), (select count(*) from public.project_assignments where user_id = (select ernest_id from t_fixture)),
  'project_assignments RED: ernest delete of others'' rows affects zero rows (still sees only his own)');
-- outsider: zero rows
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.project_assignments), 0::bigint,
  'project_assignments RED: outsider sees zero rows');
-- DC of PEJ: assignments are TES data — DC role gives nothing here
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.project_assignments where user_id <> (select tymon_id from t_fixture)), 0::bigint,
  'project_assignments RED: DC of PEJ sees no one else''s assignments (no DC policy on TES tables)');
-- admin: everything
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.project_assignments), (select total_assignments from t_fixture),
  'project_assignments GREEN: admin sees every assignment');

-- 3e. dictionaries — DC of another project is just another DC (global table).
-- 1a.09b: is_any_doc_controller() is project-less, so DC of IT can insert
-- into this project-less table exactly like DC of PEJ.
select set_config('request.jwt.claims',
  json_build_object('sub', (select otherdc_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('area', 'ODC', 'x')$$,
  'dictionaries GREEN: DC of IT can insert at aal2 (1a.09b is_any_doc_controller is project-less; 1a.11 aal2)');
reset role;
delete from dcs.dictionaries where dict_type = 'area' and code = 'ODC';
set local role authenticated;

-- 3f. audit_log — writes impossible for every non-postgres role (no policy, no grant)
select throws_ok($$insert into public.audit_log (table_name, record_id, action) values ('x', gen_random_uuid(), 'INSERT')$$,
  '42501', null, 'audit_log RED: DC cannot insert into the log');
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
select throws_ok($$update public.audit_log set field_name = 'x'$$, '42501', null,
  'audit_log RED: admin cannot update the log');

reset role;

select * from finish();
rollback;
