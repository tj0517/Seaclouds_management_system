-- Tests for public.audit_log + public.audit_trigger() (DCS 1a.08), following
-- rls_project_roles.test.sql: fixtures as postgres inside this transaction
-- (rolled back), then impersonation via the authenticated role +
-- request.jwt.claims / request.headers, exactly like PostgREST.
--
-- Projects come from seed.sql (fixed UUIDs): PEJ = 6c0909ce-…, IT = 094e130b-….
-- Users are looked up by e-mail (seed generates their UUIDs at runtime).
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- ============================================================
-- Schema assertions (red without the migration)
-- ============================================================
select has_table('public', 'audit_log', 'table public.audit_log exists');
select has_function('public', 'audit_trigger', 'function public.audit_trigger() exists');
select is_definer('public', 'audit_trigger', 'audit_trigger() is SECURITY DEFINER');
select ok(
  exists (select 1 from pg_proc p, unnest(p.proconfig) c
           where p.oid = 'public.audit_trigger()'::regprocedure
             and c in ('search_path=', 'search_path=""')),
  'audit_trigger() has search_path pinned to '''' (same convention as set_updated_at)'
);
select ok(
  not has_function_privilege('authenticated', 'public.audit_trigger()', 'execute'),
  'authenticated cannot execute audit_trigger() (no RPC surface, no lint 0029)'
);
select ok(
  not has_function_privilege('anon', 'public.audit_trigger()', 'execute'),
  'anon cannot execute audit_trigger()'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass),
  'row level security is enabled on public.audit_log'
);
select policies_are(
  'public', 'audit_log',
  array['Admins read audit log', 'Doc controllers read own project audit log'],
  'exactly two SELECT policies exist on audit_log (1a.08 admin, 1a.09 DC)'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd <> 'SELECT'),
  0::bigint,
  'zero INSERT/UPDATE/DELETE policies on audit_log'
);
select is(
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'audit_log'
      and grantee in ('authenticated', 'service_role', 'anon')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0::bigint,
  'no API role holds INSERT/UPDATE/DELETE/TRUNCATE on audit_log (only the trigger writes)'
);
select col_has_check('public', 'audit_log', 'action', 'action is CHECK-constrained');

-- Trigger attached exactly where 1a.08 says — and nowhere in TES / mdr_settings
select has_trigger('public', 'projects', 'audit_projects', 'audit trigger on public.projects');
select has_trigger('dcs', 'project_roles', 'audit_project_roles', 'audit trigger on dcs.project_roles');
select has_trigger('public', 'profiles', 'audit_profiles', 'audit trigger on public.profiles');
select has_trigger('public', 'clients', 'audit_clients', 'audit trigger on public.clients');
select is(
  (select count(*) from pg_trigger t
    where t.tgfoid = 'public.audit_trigger()'::regprocedure and not t.tgisinternal),
  4::bigint,
  'audit_trigger() is attached to exactly four tables'
);
select is(
  (select count(*) from pg_trigger t
    where t.tgfoid = 'public.audit_trigger()'::regprocedure
      and t.tgrelid in ('dcs.mdr_settings'::regclass, 'public.timesheet_entries'::regclass,
                        'public.timesheet_submissions'::regclass, 'public.project_assignments'::regclass)),
  0::bigint,
  'audit_trigger() is NOT attached to mdr_settings or any TES table'
);

-- ============================================================
-- Fixtures (as postgres, before switching roles)
-- ============================================================
create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as employee_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id;
grant select on t_fixture to authenticated;

-- Seed already produced rows (project/profile inserts and profile updates run
-- through the trigger), so every assertion below counts UPDATE rows of the
-- record it touches, not the table.
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.projects' and record_id = (select pej_id from t_fixture)
      and action = 'UPDATE'),
  0::bigint,
  'sanity: no UPDATE audit rows for PEJ before the test (seed left only its INSERT)'
);

-- ============================================================
-- 1. Sessionless write (plain psql / seed / migration): no JWT, no
--    request.headers. Must not throw; user_id and ip are NULL.
-- ============================================================
select is(current_setting('request.headers', true), null, 'sanity: request.headers is not set');
select lives_ok(
  $$update public.projects set year = 2026 where id = (select pej_id from t_fixture)$$,
  'UPDATE outside the PostgREST context succeeds (missing request.headers does not throw)'
);
select results_eq(
  $$select action, field_name, old_value, new_value, user_id, ip, project_id
      from public.audit_log
     where table_name = 'public.projects' and record_id = (select pej_id from t_fixture)
       and action = 'UPDATE'$$,
  $$values ('UPDATE', 'year', null::jsonb, '2026'::jsonb, null::uuid, null::text,
            (select pej_id from t_fixture))$$,
  'sessionless UPDATE: one row, NULL old_value (was NULL), new_value 2026, user_id NULL, ip NULL, project_id = record'
);

-- 1b. TES sign-up path: GoTrue inserts into auth.users → on_auth_user_created
--     → handle_new_user() (SECURITY DEFINER, no user session, no
--     request.headers) → INSERT into public.profiles → audit_trigger().
--     If this threw, registration in TES would break silently.
select lives_ok(
  $$insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token,
      phone_change, phone_change_token, email_change_token_current,
      email_change_confirm_status)
    values (
      '00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8',
      'authenticated', 'authenticated', 'audit08-signup@example.com', 'x', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Audit Signup"}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', 0)$$,
  'sign-up (auth.users INSERT → handle_new_user → profiles INSERT) succeeds with the audit trigger attached'
);
select is(
  (select count(*) from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8'),
  1::bigint,
  'handle_new_user() created the profile row'
);
select results_eq(
  $$select action, field_name, user_id, ip, project_id,
           new_value ->> 'role', new_value ->> 'full_name'
      from public.audit_log
     where table_name = 'public.profiles'
       and record_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8'$$,
  $$values ('INSERT', null::text, null::uuid, null::text, null::uuid, 'employee', 'Audit Signup')$$,
  'sign-up is audited: one INSERT row for profiles with user_id NULL, ip NULL, project_id NULL'
);

-- ============================================================
-- 2. Admin session, PostgREST-like context (JWT + headers)
-- ============================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text,
  true
);
select set_config(
  'request.headers',
  '{"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "pgtap"}',
  true
);

-- 2a. One changed column → one row with the session's user_id and ip
update public.projects set year = 2027 where id = (select pej_id from t_fixture);
select results_eq(
  $$select field_name, old_value, new_value, user_id, ip
      from public.audit_log
     where table_name = 'public.projects' and record_id = (select pej_id from t_fixture)
       and action = 'UPDATE' and user_id is not null$$,
  $$values ('year', '2026'::jsonb, '2027'::jsonb, (select admin_id from t_fixture), '203.0.113.7')$$,
  'admin UPDATE of projects.year: one row with user_id = admin and ip = first x-forwarded-for address'
);

-- 2b. Two columns changed at once → two rows, one per column
update public.projects
   set description = 'UXO & GEO Oversight (audited)', process_type = 'project'
 where id = (select pej_id from t_fixture);
select results_eq(
  $$select field_name, old_value, new_value
      from public.audit_log
     where table_name = 'public.projects' and record_id = (select pej_id from t_fixture)
       and field_name in ('description', 'process_type')
     order by field_name$$,
  $$values ('description', '"UXO & GEO Oversight"'::jsonb, '"UXO & GEO Oversight (audited)"'::jsonb),
           ('process_type', null::jsonb, '"project"'::jsonb)$$,
  'UPDATE of two columns writes exactly two rows, one per changed column'
);

-- 2c. No-op UPDATE → zero new rows
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.projects' and record_id = (select pej_id from t_fixture)
      and action = 'UPDATE'),
  4::bigint,
  'sanity: four UPDATE rows for PEJ so far'
);
update public.projects set year = year, name = name where id = (select pej_id from t_fixture);
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.projects' and record_id = (select pej_id from t_fixture)
      and action = 'UPDATE'),
  4::bigint,
  'UPDATE that changes nothing writes zero rows'
);

-- 2d. INSERT into project_roles → one INSERT row with the whole new row
insert into dcs.project_roles (project_id, user_id, role, assigned_by)
values ((select pej_id from t_fixture), (select employee_id from t_fixture), 'chk',
        (select admin_id from t_fixture));
select results_eq(
  $$select action, field_name, old_value, new_value ->> 'role', new_value ->> 'user_id',
           user_id, ip, project_id
      from public.audit_log
     where table_name = 'dcs.project_roles' and user_id = (select admin_id from t_fixture)$$,
  $$values ('INSERT', null::text, null::jsonb, 'chk', (select employee_id from t_fixture)::text,
            (select admin_id from t_fixture), '203.0.113.7', (select pej_id from t_fixture))$$,
  'INSERT into dcs.project_roles: action INSERT, field_name NULL, whole row in new_value, project_id from the row'
);

-- 2e. UPDATE of project_roles.role → one UPDATE row with enum values as text
update dcs.project_roles set role = 'app'
 where project_id = (select pej_id from t_fixture) and user_id = (select employee_id from t_fixture);
select results_eq(
  $$select field_name, old_value, new_value
      from public.audit_log
     where table_name = 'dcs.project_roles' and action = 'UPDATE'$$,
  $$values ('role', '"chk"'::jsonb, '"app"'::jsonb)$$,
  'role change on project_roles lands as UPDATE role chk → app'
);

-- 2f. DELETE from project_roles → one DELETE row with the whole old row
delete from dcs.project_roles
 where project_id = (select pej_id from t_fixture) and user_id = (select employee_id from t_fixture);
select results_eq(
  $$select action, field_name, new_value, old_value ->> 'role', project_id
      from public.audit_log
     where table_name = 'dcs.project_roles' and action = 'DELETE'$$,
  $$values ('DELETE', null::text, null::jsonb, 'app', (select pej_id from t_fixture))$$,
  'DELETE from dcs.project_roles: action DELETE, whole row in old_value, project_id kept'
);

-- 2g. Tables without project scope: profiles and clients → project_id NULL
update public.profiles set position = 'IT support (audited)'
 where id = (select employee_id from t_fixture);
select results_eq(
  $$select field_name, old_value, new_value, project_id
      from public.audit_log
     where table_name = 'public.profiles' and record_id = (select employee_id from t_fixture)
       and user_id = (select admin_id from t_fixture)$$,
  $$values ('position', '"It support"'::jsonb, '"IT support (audited)"'::jsonb, null::uuid)$$,
  'profiles UPDATE: one row, project_id NULL (no project scope)'
);
insert into public.clients (id, name, code)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', 'Audit Test Client', 'AUDIT08');
select results_eq(
  $$select action, new_value ->> 'code', project_id, user_id
      from public.audit_log
     where table_name = 'public.clients' and record_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8'$$,
  $$values ('INSERT', 'AUDIT08', null::uuid, (select admin_id from t_fixture))$$,
  'clients INSERT: one row, project_id NULL, user_id = admin'
);

-- 2h. Admin reads the log (RLS SELECT policy)
select cmp_ok(
  (select count(*) from public.audit_log), '>=', 9::bigint,
  'admin sees the audit rows'
);

-- 2i. Even the admin cannot write the log through the API
select throws_ok(
  $$insert into public.audit_log (table_name, record_id, action)
    values ('public.projects', gen_random_uuid(), 'INSERT')$$,
  '42501', null,
  'admin direct INSERT into audit_log is denied (42501)'
);
select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null,
  'admin DELETE from audit_log is denied (42501)'
);

-- ============================================================
-- 3. Employee (non-admin): reads nothing, writes nothing
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*) from public.audit_log), 0::bigint,
  'employee SELECT from audit_log returns 0 rows (RLS filters, no denial)'
);
select throws_ok(
  $$insert into public.audit_log (table_name, record_id, action)
    values ('public.projects', gen_random_uuid(), 'INSERT')$$,
  '42501', null,
  'employee direct INSERT into audit_log is denied (42501)'
);
select throws_ok(
  $$update public.audit_log set ip = 'x'$$,
  '42501', null,
  'employee UPDATE of audit_log is denied (42501)'
);
select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null,
  'employee DELETE from audit_log is denied (42501)'
);

-- The admin rows above were written by a session that itself has no INSERT
-- right on audit_log — the trigger inserts as its owner (SECURITY DEFINER),
-- not as the caller.
select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'insert'),
  'the session that produced the admin rows had no INSERT privilege — writes came from the trigger'
);
-- The one write a non-admin may do on an audited table (own profile) is
-- recorded under their user_id although they cannot read or write the log.
update public.profiles set position = 'edited by the employee'
 where id = (select employee_id from t_fixture);

-- ============================================================
-- 4. Anon: no grants at all
-- ============================================================
set local role anon;
select throws_ok(
  'select count(*) from public.audit_log', '42501', null,
  'anon cannot select from audit_log (permission denied)'
);
reset role;

select results_eq(
  $$select field_name, old_value, new_value, user_id, ip
      from public.audit_log
     where table_name = 'public.profiles' and record_id = (select employee_id from t_fixture)
       and user_id = (select employee_id from t_fixture)$$,
  $$values ('position', '"IT support (audited)"'::jsonb, '"edited by the employee"'::jsonb,
            (select employee_id from t_fixture), '203.0.113.7')$$,
  'employee''s own profile edit is audited under their user_id (SECURITY DEFINER write, caller has no INSERT)'
);

-- ============================================================
-- 5. Project deletion: roles cascade, the trail survives (no FK on
--    project_id) and records the cascade as DELETE rows
-- ============================================================
insert into public.projects (id, name, project_code)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab8', 'DCS Test Audit', 'SC9908');
insert into dcs.project_roles (project_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab8', (select employee_id from t_fixture), 'view');
delete from public.projects where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab8';
-- occurred_at is the transaction timestamp, so within this single test
-- transaction the four rows are indistinguishable by time — compare as a bag.
select bag_eq(
  $$select table_name, action from public.audit_log
     where project_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab8'$$,
  $$values ('public.projects', 'INSERT'), ('dcs.project_roles', 'INSERT'),
           ('dcs.project_roles', 'DELETE'), ('public.projects', 'DELETE')$$,
  'project lifecycle incl. cascaded role deletion is fully recorded and survives the delete'
);

select * from finish();
rollback;
