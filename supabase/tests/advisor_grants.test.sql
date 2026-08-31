-- Guards for the advisor-security baseline (see docs/03-conventions.md,
-- "Advisor" section): lints 0011/0026/0028 must stay at zero, while the
-- authenticated role keeps the grants that RLS policies and the apps rely on
-- (lints 0027/0029 are accepted deliberately — do not "fix" them).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

select * from finish();
rollback;
