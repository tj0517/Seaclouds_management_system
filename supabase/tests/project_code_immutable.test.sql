-- Tests for DCS 1a.17c: the BEFORE UPDATE trigger projects_project_code_immutable
-- on public.projects (migration 20260915081813) — `project_code` may never
-- change, for anybody. It is already embedded in CTR codes (SC2699_CTR100) and
-- in timesheet history, and from 1b.02 it is the first segment of every SCL
-- document number (SC2601-SCL-RA-0012-EN, docs/00-glossary.md).
--
-- Follows dcs_create_project_mdr.test.sql (1a.17, the newest file at the time
-- of writing), which follows dictionaries_code_immutable.test.sql (1a.15b):
-- fixtures as postgres inside this transaction (rolled back), then
-- impersonation via `authenticated` + request.jwt.claims, exactly like
-- PostgREST.
--
-- The point of the impersonated half is that the trigger is NOT an RLS
-- refinement: the admin session in section 5 is fully entitled to UPDATE the
-- row ("Admin zarządza projektami" is ALL / is_admin() with no column
-- restriction — read from scl-dev 2026-09-15), and is still refused the code
-- change, with 23001 (restrict_violation) raised by the trigger, not 42501
-- from a policy.
--
-- Cast:
--   admin  tjezionekspam@gmail.com  profiles.role = admin
-- Fixture project is created here, not taken from the seed: the seed rows
-- (SCMS-IT, SC2602) are read by other suites and by the apps.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ============================================================
-- 0. Trigger and function shape (red without the migration)
-- ============================================================
select has_trigger('public', 'projects', 'projects_project_code_immutable',
  'projects_project_code_immutable trigger is attached');
select is(
  (select tgtype from pg_trigger
    where tgrelid = 'public.projects'::regclass and tgname = 'projects_project_code_immutable'),
  19::smallint,
  'it is a BEFORE UPDATE FOR EACH ROW trigger (tgtype 19 = ROW|BEFORE|UPDATE), the same shape as dictionaries_code_immutable');
select is(
  (select tgfoid::regproc::text from pg_trigger
    where tgrelid = 'public.projects'::regclass and tgname = 'projects_project_code_immutable'),
  'forbid_project_code_change', 'it executes public.forbid_project_code_change()');
select has_function('public', 'forbid_project_code_change',
  'public.forbid_project_code_change() exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forbid_project_code_change'),
  false,
  'the trigger function is SECURITY INVOKER — it adds no SECURITY DEFINER function to advisor lint 0029');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forbid_project_code_change'
      and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')),
  1::bigint,
  'the trigger function has a pinned search_path (advisor lint 0011 baseline is zero)');
select ok(
  not has_function_privilege('anon', 'public.forbid_project_code_change()', 'execute'),
  'anon cannot execute the trigger function (lint 0028)');
select ok(
  not has_function_privilege('authenticated', 'public.forbid_project_code_change()', 'execute'),
  'authenticated cannot execute the trigger function — EXECUTE is checked when the trigger is created, not when it fires');

-- ============================================================
-- Fixtures (as postgres). SC9901 matches projects_project_code_format
-- (^SC\d{4}$) and collides with nothing in the seed.
-- ============================================================
insert into public.projects (id, name, description, project_code, is_active)
values ('a17c0000-0000-4000-8000-000000000001', 'Immutability fixture',
        'description that must survive a name edit', 'SC9901', true);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  'a17c0000-0000-4000-8000-000000000001'::uuid as row_id;
grant select on t_fixture to authenticated;

-- ============================================================
-- 1. postgres itself (superuser, table owner, RLS-exempt) is not exempt.
-- ============================================================
select throws_ok(
  $$update public.projects set project_code = 'SC9902' where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  '23001', null,
  'RED: a direct SQL code change is rejected with 23001 (restrict_violation), even as postgres');
select throws_like(
  $$update public.projects set project_code = project_code || 'X' where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  '%public.projects.project_code is immutable%',
  'the error names the table and the column, and says why');
select is(
  (select project_code from public.projects where id = (select row_id from t_fixture)),
  'SC9901', 'the stored project_code is unchanged after the rejected statements');
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.projects' and record_id = (select row_id from t_fixture)
      and action = 'UPDATE'),
  0::bigint,
  'a rejected code change writes no audit_log row (the BEFORE trigger aborts before audit_projects)');

-- ============================================================
-- 2. Restating the unchanged code in SET is fine: the trigger compares values
--    (IS DISTINCT FROM), it does not look at which columns the statement
--    lists.
-- ============================================================
select lives_ok(
  $$update public.projects set project_code = 'SC9901' where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  'GREEN: restating the SAME project_code in SET is allowed — the trigger compares values, not column lists');
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.projects' and record_id = (select row_id from t_fixture)
      and action = 'UPDATE'),
  0::bigint,
  'and it changed nothing, so audit_trigger logged nothing — no column differs');

-- ============================================================
-- 3. The shape apps/timesheet now sends: name, description and is_active,
--    with project_code absent from the statement altogether.
-- ============================================================
select lives_ok(
  $$update public.projects
       set name = 'Immutability fixture (renamed)',
           description = 'description rewritten too',
           is_active = false
     where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  'GREEN: the TES payload shape (no project_code in SET) succeeds');
select results_eq(
  $$select field_name, old_value, new_value
      from public.audit_log
     where table_name = 'public.projects' and record_id = 'a17c0000-0000-4000-8000-000000000001'
       and action = 'UPDATE'
     order by field_name$$,
  $$values ('description', '"description that must survive a name edit"'::jsonb, '"description rewritten too"'::jsonb),
           ('is_active',   'true'::jsonb,  'false'::jsonb),
           ('name',        '"Immutability fixture"'::jsonb, '"Immutability fixture (renamed)"'::jsonb)$$,
  'exactly three audit_log rows — one per column that actually changed, and none for project_code');
select is(
  (select project_code from public.projects where id = (select row_id from t_fixture)),
  'SC9901', 'updates to other columns leave project_code alone');

-- ============================================================
-- 4. The failure mode a half-done frontend change produces: a disabled input
--    is omitted from FormData, so a payload builder that still reads the field
--    would send NULL. That must surface as this trigger's message, not as a
--    bare 23502 from the NOT NULL added in 20260901082600 — the BEFORE trigger
--    runs before the constraint is checked.
-- ============================================================
select throws_ok(
  $$update public.projects set project_code = null where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  '23001', null,
  'blanking the code is rejected by the trigger (23001), not by NOT NULL (23502)');
select throws_like(
  $$update public.projects set project_code = null where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  '%public.projects.project_code is immutable%',
  'and the message is the task-specific one, so the cause is readable from the error alone');

-- ============================================================
-- 5. No bypass for the session that IS entitled to update the row: admin.
--    "Admin zarządza projektami" is ALL / is_admin() with no WITH CHECK and no
--    column list, which is exactly the hole docs/deferred-tasks.md (ee)
--    recorded. is_admin() reads profiles.role only — no aal requirement, so
--    the claims below carry none.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
select lives_ok(
  $$update public.projects set name = 'renamed by admin'
     where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  'sanity: the admin session really may update this row (RLS lets it through)');
select throws_ok(
  $$update public.projects set project_code = 'SC9903'
     where id = 'a17c0000-0000-4000-8000-000000000001'$$,
  '23001', null,
  'RED: admin is refused the code change by the trigger (23001), not by a policy (42501) — no bypass');

reset role;
select is(
  (select project_code from public.projects where id = (select row_id from t_fixture)),
  'SC9901', 'after every attempt above, the project_code is still the original one');

select * from finish();
rollback;
