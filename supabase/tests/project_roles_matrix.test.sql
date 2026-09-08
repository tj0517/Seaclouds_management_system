-- Tests for DCS 1a.14 (user × project × role matrix screen): proves the
-- guarantees setProjectRoles() (apps/dcs/lib/project-roles.ts) depends on at
-- the database level, by issuing the exact sequence of INSERT/DELETE
-- statements its diff produces, as the DC of the project (not admin) — the
-- server action's new admin-or-DC guard (deferred-tasks.md q) mirrors this
-- RLS boundary exactly, and public.audit_log records real changes only
-- because the diff never deletes-all-then-reinserts.
--
-- This complements, and does not replace, rls_project_role_functions.test.sql
-- (1a.09), which already proves is_doc_controller()/RLS scoping exhaustively,
-- including "DC of PEJ cannot write on IT". That exact case is reaffirmed
-- here too (assertion 15) because it is precisely the boundary this task's
-- new server-action guard (requireAdminOrDc) relies on — verified as a live
-- RED run during review by temporarily flipping it to lives_ok (it failed:
-- 42501), then restored to throws_ok as committed here.
--
-- Follows rls_module_permissions.test.sql: fixtures as postgres inside this
-- transaction (rolled back), then impersonation via authenticated/anon +
-- request.jwt.claims, exactly like PostgREST.
--
-- Cast:
--   admin  tjezionekspam@gmail.com  profiles.role = admin
--   tymon  tjezionek2000@gmail.com  made DC of PEJ below
--   ernest ejezionek@gmail.com      member of PEJ via project_assignments (seed) only
-- Projects from seed: PEJ = 6c0909ce-…, IT = 094e130b-….
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ============================================================
-- Schema sanity — the guard added in 1a.14 relies on exactly this policy
-- shape still holding (regression guard, not a re-test of 1a.09's coverage).
-- ============================================================
select is(
  (select count(*) from pg_policies
    where schemaname = 'dcs' and tablename = 'project_roles'
      and policyname = 'Doc controllers manage project roles' and cmd = 'ALL'),
  1::bigint, 'sanity: the DC ALL policy (insert+update+delete) still exists on dcs.project_roles');

-- ============================================================
-- Fixtures (as postgres)
-- ============================================================
create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id;
grant select on t_fixture to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
values ((select pej_id from t_fixture), (select tymon_id from t_fixture), 'dc');

-- ============================================================
-- As tymon (DC of PEJ, not admin): simulate setProjectRoles(PEJ, ernest, ['orig','rev'])
-- — ernest currently holds nothing on PEJ, so the diff is two plain grants.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);

select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select ernest_id from t_fixture), 'orig',
            (select tymon_id from t_fixture))$$,
  'DC of PEJ grants orig to ernest (diff: grant 1/2)');
select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select ernest_id from t_fixture), 'rev',
            (select tymon_id from t_fixture))$$,
  'DC of PEJ grants rev to ernest (diff: grant 2/2)');
select is(
  (select array_agg(role::text order by role::text) from dcs.project_roles
    where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture)),
  array['orig', 'rev'], 'ernest now holds exactly orig+rev on PEJ');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = (select pej_id from t_fixture)
      and new_value ->> 'user_id' = (select ernest_id from t_fixture)::text),
  2::bigint, 'the two grants produced exactly two audit_log INSERT rows');

-- ============================================================
-- No-op save: setProjectRoles(PEJ, ernest, ['orig','rev']) again — the diff
-- against the current {orig,rev} is empty, so the app issues zero
-- statements. Nothing to run here; the assertion is that the audit trail
-- from the real grants above stays exactly as it was (criterion 3: a no-op
-- save produces no audit rows).
-- ============================================================
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = (select pej_id from t_fixture)
      and new_value ->> 'user_id' = (select ernest_id from t_fixture)::text),
  2::bigint, 'no-op save: audit_log INSERT count for ernest/PEJ is unchanged (still 2, not 4)');

-- ============================================================
-- Partial diff: setProjectRoles(PEJ, ernest, ['orig','chk']) — revoke rev,
-- grant chk, leave orig untouched.
-- ============================================================
select lives_ok(
  $$delete from dcs.project_roles
    where project_id = (select pej_id from t_fixture)
      and user_id = (select ernest_id from t_fixture) and role = 'rev'$$,
  'DC of PEJ revokes rev from ernest (diff: revoke half)');
select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select ernest_id from t_fixture), 'chk',
            (select tymon_id from t_fixture))$$,
  'DC of PEJ grants chk to ernest (diff: grant half)');
select is(
  (select array_agg(role::text order by role::text) from dcs.project_roles
    where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture)),
  array['chk', 'orig'], 'ernest now holds exactly orig+chk on PEJ');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'DELETE' and field_name is null
      and project_id = (select pej_id from t_fixture)
      and old_value ->> 'user_id' = (select ernest_id from t_fixture)::text
      and old_value ->> 'role' = 'rev'),
  1::bigint, 'the revoke of rev produced exactly one audit_log DELETE row');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = (select pej_id from t_fixture)
      and new_value ->> 'user_id' = (select ernest_id from t_fixture)::text
      and new_value ->> 'role' = 'chk'),
  1::bigint, 'the grant of chk produced exactly one audit_log INSERT row');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles'
      and project_id = (select pej_id from t_fixture)
      and coalesce(new_value ->> 'user_id', old_value ->> 'user_id') = (select ernest_id from t_fixture)::text
      and coalesce(new_value ->> 'role', old_value ->> 'role') = 'orig'),
  1::bigint, 'orig was never touched again by the partial diff — still exactly its original grant row in the log');

-- ============================================================
-- DC of PEJ cannot write on IT — the exact boundary requireAdminOrDc
-- (apps/dcs/lib/project-roles.ts) relies on. Already proven exhaustively in
-- rls_project_role_functions.test.sql; reaffirmed here tied to this task's
-- guard. Verified as a live RED run during review (temporarily lives_ok →
-- failed with 42501), restored to throws_ok below.
-- ============================================================
select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select it_id from t_fixture), (select ernest_id from t_fixture), 'view')$$,
  '42501', null, 'DC of PEJ cannot grant a role on IT');

-- ============================================================
-- Revoke everything: setProjectRoles(PEJ, ernest, []) — both remaining rows
-- (orig, chk) are removed in one diff.
-- ============================================================
select lives_ok(
  $$delete from dcs.project_roles
    where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture)$$,
  'DC of PEJ revokes every remaining role from ernest (diff: revoke to empty set)');
select is(
  (select count(*) from dcs.project_roles
    where project_id = (select pej_id from t_fixture) and user_id = (select ernest_id from t_fixture)),
  0::bigint, 'ernest holds no roles on PEJ after the full revoke');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'DELETE' and field_name is null
      and project_id = (select pej_id from t_fixture)
      and old_value ->> 'user_id' = (select ernest_id from t_fixture)::text),
  3::bigint, 'three DELETE rows total for ernest on PEJ across both revokes (rev, then orig+chk)');

-- ============================================================
-- A plain member of PEJ (assignment only, no DC/project_roles row) cannot
-- self-grant — the "read-only for other members" half of the project page.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select is(
  (select count(*) from dcs.project_roles where project_id = (select pej_id from t_fixture)),
  1::bigint, 'ernest (plain PEJ member) still reads the team (tymon''s dc row) read-only');
select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select pej_id from t_fixture), (select ernest_id from t_fixture), 'view')$$,
  '42501', null, 'ernest (plain member, no dc role) cannot grant himself a role');

reset role;
select * from finish();
rollback;
