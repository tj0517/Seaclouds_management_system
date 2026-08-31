-- Guards for the advisor-security baseline (see docs/03-conventions.md,
-- "Advisor" section): lints 0011/0026/0028 must stay at zero, while the
-- authenticated role keeps the grants that RLS policies and the apps rely on
-- (lints 0027/0029 are accepted deliberately — do not "fix" them).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ============================================================
-- 0011: every public function has a pinned search_path
-- ============================================================
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c
                           where c like 'search_path=%'))),
  0::bigint,
  'no public function has a mutable search_path (lint 0011)'
);

-- ============================================================
-- 0026 / 0028: anon holds nothing in schema public
-- (has_function_privilege also covers the implicit PUBLIC grant)
-- ============================================================
select is(
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'anon'),
  0::bigint,
  'anon holds no table privileges in schema public (lint 0026)'
);
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint,
  'anon cannot execute any function in schema public (lint 0028)'
);

-- Default privileges must not hand anon grants back to future objects.
-- Scoped to defaclrole = postgres: migrations run as postgres, so only its
-- defaults apply to objects they create; the supabase_admin defaults are
-- platform-managed and not alterable from a migration.
select is(
  (select count(*)
     from pg_default_acl d
     cross join lateral aclexplode(d.defaclacl) a
     join pg_roles r on r.oid = a.grantee
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclrole = 'postgres'::regrole
      and r.rolname = 'anon'),
  0::bigint,
  'default privileges of role postgres in schema public contain no anon entries'
);

-- ============================================================
-- Deliberately kept (0027/0029): authenticated is how PostgREST runs
-- signed-in users; RLS policies call these functions as that role.
-- ============================================================
select ok(
  has_function_privilege('authenticated', 'public.is_admin()', 'execute'),
  'authenticated keeps execute on is_admin (used by RLS policies)'
);
select ok(
  has_function_privilege('authenticated', 'public.is_week_locked(date, uuid)', 'execute'),
  'authenticated keeps execute on is_week_locked (timesheet_entries policies)'
);
select ok(
  has_function_privilege('authenticated', 'public.resubmit_rejected(uuid, uuid)', 'execute'),
  'authenticated keeps execute on resubmit_rejected (called via RPC)'
);
select ok(
  has_table_privilege('authenticated', 'public.projects', 'select'),
  'authenticated keeps select on projects (row security is RLS, not grants)'
);

-- ============================================================
-- Runtime invocation of the functions the metadata checks above never execute.
-- An empty search_path qualifies neither TABLE nor TYPE names, so a bare
-- reference (e.g. 'admin'::user_role or an unqualified table) fails on the
-- first CALL, not at migration time. These assertions actually run
-- is_admin_or_pm, is_pm_for_project and set_updated_at to prove the bodies
-- resolve the user_role enum and their tables at runtime.
-- ============================================================
create temp table t_inv as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as employee_id,
  (select pa.project_id
     from public.project_assignments pa
     join public.profiles pr on pr.id = pa.user_id
    where pr.role = 'admin'
    limit 1) as assigned_project_id,
  (select p.id from public.projects p
    where p.id not in (
      select pa.project_id from public.project_assignments pa
      join auth.users u on u.id = pa.user_id
      where u.email = 'tjezionekspam@gmail.com')
    limit 1) as unassigned_project_id;
grant select on t_inv to authenticated;

-- is_admin_or_pm(): exercises `role IN ('admin', 'project_lead')`.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_inv), 'role', 'authenticated')::text,
  true);
select ok(
  public.is_admin_or_pm(),
  'is_admin_or_pm() runs and returns true for an admin (user_role enum resolves at runtime)'
);
reset role;

-- is_pm_for_project(uuid): make the admin a project_lead for the duration of
-- the (rolled-back) tx so the `pr.role = 'project_lead'` branch returns a row.
update public.profiles set role = 'project_lead'
  where id = (select admin_id from t_inv);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_inv), 'role', 'authenticated')::text,
  true);
select ok(
  public.is_pm_for_project((select assigned_project_id from t_inv)),
  'is_pm_for_project() runs and returns true for a project_lead on an assigned project'
);
select ok(
  not public.is_pm_for_project((select unassigned_project_id from t_inv)),
  'is_pm_for_project() runs and returns false for an unassigned project'
);
reset role;

-- set_updated_at(): BEFORE UPDATE trigger on user_monthly_earnings. Insert a
-- row with a stale updated_at, UPDATE it, and confirm the trigger advanced the
-- timestamp — proves the trigger body (now()) runs under empty search_path.
insert into public.user_monthly_earnings
  (id, user_id, year_month, amount, currency, created_by, created_at, updated_at)
values
  (gen_random_uuid(), (select employee_id from t_inv), '2026-01', 100, 'PLN',
   (select admin_id from t_inv), now(), timestamptz '2000-01-01');
update public.user_monthly_earnings set amount = 200
  where user_id = (select employee_id from t_inv) and year_month = '2026-01';
select cmp_ok(
  (select updated_at from public.user_monthly_earnings
    where user_id = (select employee_id from t_inv) and year_month = '2026-01'),
  '>', timestamptz '2020-01-01',
  'set_updated_at() trigger ran on UPDATE and advanced updated_at'
);

select * from finish();
rollback;
