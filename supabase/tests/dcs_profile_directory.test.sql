-- Tests for DCS 1a.14b: public.dcs_profile_directory() — the SECURITY
-- DEFINER name directory that makes ADR-0012 real (a DC/admin can see
-- co-members' names and pick new ones without a profiles RLS policy that
-- would leak rate_hourly/rate_daily). Also asserts the two policies this
-- task is explicitly forbidden from touching (public.projects,
-- public.profiles) are byte-identical to the baseline.
--
-- Follows project_roles_matrix.test.sql (1a.14, the newest file at the time
-- of writing): fixtures as postgres inside this transaction (rolled back),
-- then impersonation via authenticated/anon + request.jwt.claims, exactly
-- like PostgREST.
--
-- Cast:
--   admin    tjezionekspam@gmail.com  profiles.role = admin
--   tymon    tjezionek2000@gmail.com  made DC of PEJ below
--   ernest   ejezionek@gmail.com      given 'orig' on PEJ below (plain member, not DC)
--   outsider created here             no project_roles row anywhere
-- Projects from seed: PEJ = 6c0909ce-…, IT = 094e130b-….
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ============================================================
-- 0. Unchanged-policy guard — this task must not touch either policy.
-- ============================================================
select is(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'projects'
     and policyname = 'Widoczność projektów'),
  '(auth.role() = ''authenticated''::text)',
  'public.projects SELECT policy ("Widoczność projektów") is byte-identical to baseline');
select is(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'profiles'
     and policyname = 'Bezpieczny dostęp do profili'),
  '((auth.uid() = id) OR is_admin())',
  'public.profiles SELECT policy ("Bezpieczny dostęp do profili") is byte-identical to baseline');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'projects'),
  2::bigint, 'sanity: public.projects still has exactly its two known policies (SELECT + admin ALL)');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  3::bigint, 'sanity: public.profiles still has exactly its three known policies (SELECT + two UPDATE)');

-- ============================================================
-- 1. Shape: exactly two OUT columns, id + full_name, never a rate column.
-- ============================================================
select is(
  (select count(*) from information_schema.routines r
     join information_schema.parameters p
       on p.specific_schema = r.specific_schema and p.specific_name = r.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'dcs_profile_directory'
      and p.parameter_mode = 'OUT'),
  2::bigint, 'dcs_profile_directory() returns exactly two output columns');
select bag_eq(
  $$select p.parameter_name from information_schema.routines r
      join information_schema.parameters p
        on p.specific_schema = r.specific_schema and p.specific_name = r.specific_name
     where r.routine_schema = 'public' and r.routine_name = 'dcs_profile_directory'
       and p.parameter_mode = 'OUT'$$,
  $$values ('id'), ('full_name')$$,
  'the two output columns are exactly id and full_name');
select throws_ok(
  $$select rate_hourly from public.dcs_profile_directory()$$,
  '42703', null,
  'RED: rate_hourly does not exist on the function''s result — the column is not there to leak');

-- ============================================================
-- Fixtures (as postgres)
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed',
   'authenticated', 'authenticated', 'outsider-1a14b@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Outsider"}', now(), now(),
   '', '', '', '', '', '', '', 0);

insert into dcs.project_roles (project_id, user_id, role)
select
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid,
  id,
  'dc'
 from auth.users where email = 'tjezionek2000@gmail.com';
insert into dcs.project_roles (project_id, user_id, role)
select
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid,
  id,
  'orig'
 from auth.users where email = 'ejezionek@gmail.com';

-- total_profiles captured HERE, as postgres (bypasses RLS) — every later
-- "sees the whole directory" assertion compares against this fixed number,
-- never a live `count(*) from public.profiles` re-queried under a
-- restricted session's own RLS (which would silently return that session's
-- own visible subset instead, defeating the assertion).
create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed'::uuid as outsider_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,
  (select count(*) from public.profiles) as total_profiles,
  (select full_name from public.profiles where id = (select id from auth.users where email = 'tjezionek2000@gmail.com')) as tymon_full_name;
grant select on t_fixture to authenticated;

select is((select total_profiles from t_fixture), 4::bigint,
  'sanity: four profiles exist (three seed + outsider)');

-- ============================================================
-- 2. anon cannot execute at all.
-- ============================================================
set local role anon;
select throws_ok('select * from public.dcs_profile_directory()', '42501', null,
  'RED: anon cannot execute dcs_profile_directory()');
reset role;

-- ============================================================
-- 3. Outsider (no project_roles row anywhere, not admin): sees only self —
-- zero of PEJ's actual members (tymon, ernest).
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);

select is(
  (select count(*) from public.dcs_profile_directory()),
  1::bigint, 'RED: outsider sees exactly one row (their own), not the whole directory');
select is(
  (select count(*) from public.dcs_profile_directory() d
    where d.id in ((select tymon_id from t_fixture), (select ernest_id from t_fixture))),
  0::bigint, 'RED: outsider sees zero of PEJ''s actual members');
select ok(
  exists(select 1 from public.dcs_profile_directory() d where d.id = (select outsider_id from t_fixture)),
  'GREEN: outsider always sees their own row');

-- ============================================================
-- 4. Plain member (ernest, holds orig on PEJ, not DC, not admin): sees
-- co-members of PEJ (tymon) and self — nobody else.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);

select is(
  (select count(*) from public.dcs_profile_directory()),
  2::bigint, 'GREEN: ernest (plain PEJ member) sees exactly two rows (self + tymon)');
select bag_eq(
  $$select id from public.dcs_profile_directory()$$,
  format($$values ('%s'::uuid), ('%s'::uuid)$$,
    (select tymon_id from t_fixture), (select ernest_id from t_fixture)),
  'GREEN: the two rows are exactly ernest and tymon (his PEJ co-member)');
select is(
  (select count(*) from public.dcs_profile_directory() d where d.id = (select admin_id from t_fixture)),
  0::bigint, 'RED: ernest does not see admin (not a co-member, not admin himself)');
select is(
  (select full_name from public.dcs_profile_directory() d where d.id = (select tymon_id from t_fixture)),
  (select tymon_full_name from t_fixture),
  'GREEN: the co-member''s full_name matches profiles.full_name exactly (captured pre-impersonation, as postgres)');

-- ============================================================
-- 5. DC (tymon, dc on PEJ, not admin): sees the whole directory —
-- is_any_doc_controller() is project-less, so this holds regardless of
-- which project he is DC of.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated')::text, true);
select ok(public.is_any_doc_controller(), 'sanity: tymon is recognised as a DC of some project');
select is(
  (select count(*) from public.dcs_profile_directory()),
  (select total_profiles from t_fixture),
  'GREEN: DC (tymon) sees the whole directory, same row count as public.profiles');
select ok(
  exists(select 1 from public.dcs_profile_directory() d where d.id = (select outsider_id from t_fixture)),
  'GREEN: DC sees even the outsider, who shares no project with him');

-- ============================================================
-- 6. Admin: sees the whole directory too.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);
select is(
  (select count(*) from public.dcs_profile_directory()),
  (select total_profiles from t_fixture),
  'GREEN: admin sees the whole directory, same row count as public.profiles');

-- ============================================================
-- Deliberately-broken case (acceptance criteria "Verification"): try to
-- select a rates column from the function's result AS the plain member —
-- must fail with "column does not exist", not a permissions error, proving
-- the column is structurally absent, not merely filtered.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);
select throws_ok(
  $$select rate_hourly from public.dcs_profile_directory()$$,
  '42703', null,
  'RED: rate_hourly still does not exist even as a plain authenticated member');

reset role;
select * from finish();
rollback;
