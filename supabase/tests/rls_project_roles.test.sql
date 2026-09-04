-- RLS tests for dcs.project_roles (DCS 1a.06), following
-- rls_timesheet_entries.test.sql / rls_mdr_settings.test.sql: fixtures as
-- postgres inside this transaction (rolled back), then impersonation via the
-- authenticated/anon roles + request.jwt.claims, exactly like PostgREST.
--
-- Projects come from seed.sql (fixed UUIDs): PEJ = 6c0909ce-…, IT = 094e130b-….
-- Users are looked up by e-mail (seed generates their UUIDs at runtime).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ============================================================
-- Schema assertions (red without the migration)
-- ============================================================
select has_table('dcs', 'project_roles', 'table dcs.project_roles exists');
select has_enum('dcs', 'project_role', 'enum dcs.project_role exists');
select enum_has_labels(
  'dcs', 'project_role', array['orig', 'rev', 'chk', 'app', 'dc', 'view'],
  'enum dcs.project_role has exactly orig/rev/chk/app/dc/view'
);
select col_is_unique(
  'dcs', 'project_roles', array['project_id', 'user_id', 'role'],
  '(project_id, user_id, role) is unique'
);
select ok(
  (select relrowsecurity from pg_class
    where oid = 'dcs.project_roles'::regclass),
  'row level security is enabled on dcs.project_roles'
);
-- 1a.09 replaced the narrow "own rows" SELECT with project-wide membership
-- and added the DC policy; the DC/member boundaries are proven in
-- rls_project_role_functions.test.sql.
select policies_are(
  'dcs', 'project_roles',
  array['Project members read project roles', 'Doc controllers manage project roles',
        'Admins manage project roles'],
  'exactly the three policies exist (1a.06 admin + 1a.09 member read / DC manage)'
);

-- ============================================================
-- Fixtures (as postgres, before switching roles)
-- ============================================================
create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as employee_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as other_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id;
grant select on t_fixture to authenticated;

select is(
  (select count(*) from dcs.project_roles), 0::bigint,
  'sanity: no project roles exist before the test'
);

-- ============================================================
-- 1. Anon (signed out) cannot read project_roles at all — no grants
-- ============================================================
set local role anon;

select throws_ok(
  'select count(*) from dcs.project_roles',
  '42501',
  null,
  'anon cannot select from project_roles (permission denied)'
);

reset role;

-- ============================================================
-- 2. Admin grants roles: two different roles to the same person in the same
--    project both land; a role for another person lands too.
-- ============================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select employee_id from t_fixture), 'chk',
            (select admin_id from t_fixture))$$,
  'admin grants chk to the employee on PEJ'
);
select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select employee_id from t_fixture), 'app',
            (select admin_id from t_fixture))$$,
  'admin grants app to the same employee on the same project (second role)'
);
select lives_ok(
  $$insert into dcs.project_roles (project_id, user_id, role, assigned_by)
    values ((select pej_id from t_fixture), (select other_id from t_fixture), 'dc',
            (select admin_id from t_fixture))$$,
  'admin grants dc to another user on PEJ'
);
select is(
  (select count(*) from dcs.project_roles), 3::bigint,
  'admin sees all three role rows'
);
select is(
  (select array_agg(role::text order by role::text) from dcs.project_roles
    where user_id = (select employee_id from t_fixture)),
  array['app', 'chk'],
  'the employee holds both chk and app on PEJ'
);

-- Constraints still apply to the admin
select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select pej_id from t_fixture), (select employee_id from t_fixture), 'chk')$$,
  '23505',
  null,
  'granting the same role twice violates UNIQUE (project_id, user_id, role)'
);
select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select pej_id from t_fixture), 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'view')$$,
  '23503',
  null,
  'user_id outside profiles violates the FK'
);

-- ============================================================
-- 3. Employee (non-admin, member of PEJ through their roles) reads the whole
--    PEJ team (1a.09) and cannot write
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*) from dcs.project_roles), 3::bigint,
  'employee (PEJ member) sees all three PEJ role rows'
);
select is(
  (select count(*) from dcs.project_roles
    where user_id <> (select employee_id from t_fixture)),
  1::bigint,
  'employee sees the one PEJ row belonging to the other user (same project team)'
);

select throws_ok(
  $$insert into dcs.project_roles (project_id, user_id, role)
    values ((select it_id from t_fixture), (select employee_id from t_fixture), 'orig')$$,
  '42501',
  'new row violates row-level security policy for table "project_roles"',
  'employee cannot grant themselves a role (RLS denies insert)'
);

-- Data-modifying CTEs cannot be subqueries, so run the write top-level
-- (silently matches zero rows under RLS) and assert the state afterwards.
update dcs.project_roles set role = 'dc'
 where user_id = (select employee_id from t_fixture) and role = 'chk';
select is(
  (select count(*) from dcs.project_roles
    where user_id = (select employee_id from t_fixture) and role = 'dc'),
  0::bigint,
  'employee update of their own row has no effect'
);

delete from dcs.project_roles where user_id = (select employee_id from t_fixture);
select is(
  (select count(*) from dcs.project_roles), 3::bigint,
  'employee delete of their own rows has no effect'
);

-- ============================================================
-- 4. The other user (dc on PEJ) also reads the whole PEJ team
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select other_id from t_fixture), 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*) from dcs.project_roles), 3::bigint,
  'the other user (PEJ member) sees all three PEJ role rows'
);

-- ============================================================
-- 5. Admin revokes a role
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text,
  true
);
delete from dcs.project_roles
 where user_id = (select other_id from t_fixture) and role = 'dc';
select is(
  (select count(*) from dcs.project_roles), 2::bigint,
  'admin delete revokes the role'
);

reset role;

-- ============================================================
-- 6. ON DELETE CASCADE: roles vanish with their project
-- ============================================================
insert into public.projects (id, name, project_code)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab6', 'DCS Test Roles', 'SC9906');
insert into dcs.project_roles (project_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab6', (select employee_id from t_fixture), 'view');
delete from public.projects where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab6';
select is(
  (select count(*) from dcs.project_roles
    where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab6'),
  0::bigint,
  'deleting a project cascades to its role rows'
);

select * from finish();
rollback;
