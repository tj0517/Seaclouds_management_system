-- RLS tests for public.timesheet_entries, run against a database rebuilt from
-- migrations + seed (supabase db reset). Pattern for future DCS tests:
-- fixture lookups run as postgres, then impersonate users via the
-- `authenticated` role + request.jwt.claims, exactly like PostgREST does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ============================================================
-- Fixtures (as postgres, before switching roles).
-- Seed generates user UUIDs at runtime, so look them up by email.
-- ============================================================
create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as employee_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select count(*) from public.timesheet_entries) as total_entries,
  (select count(*) from public.timesheet_entries
     where user_id = (select id from auth.users where email = 'tjezionek2000@gmail.com')
  ) as employee_entries;
grant select on t_fixture to authenticated;

select cmp_ok(
  (select total_entries from t_fixture), '>', 0::bigint,
  'seed sanity: timesheet entries exist'
);
select cmp_ok(
  (select employee_entries from t_fixture), '<', (select total_entries from t_fixture),
  'seed sanity: other users'' entries exist, so visibility tests are meaningful'
);

-- ============================================================
-- 1. Employee sees only their own entries
-- ============================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*) from public.timesheet_entries),
  (select employee_entries from t_fixture),
  'employee sees exactly their own entries'
);
select is(
  (select count(*) from public.timesheet_entries
    where user_id <> (select employee_id from t_fixture)),
  0::bigint,
  'employee sees zero entries belonging to others'
);

-- ============================================================
-- 2. Admin sees everyone's entries
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*) from public.timesheet_entries),
  (select total_entries from t_fixture),
  'admin sees all entries'
);

-- ============================================================
-- 3. Employee cannot write into a locked week
-- Seed submits week 2026-06-01 for the employee on sub-project
-- 39ac163d-d2d0-4b5d-96dc-1516363dad27 (fixed UUID in seed.sql), which locks
-- it via is_week_locked. RLS WITH CHECK must reject the insert (SQLSTATE 42501).
-- ============================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select employee_id from t_fixture), 'role', 'authenticated')::text,
  true
);

select throws_ok(
  format(
    'insert into public.timesheet_entries (user_id, sub_project_id, work_date, hours) values (%L, %L, %L, 2)',
    (select employee_id from t_fixture),
    '39ac163d-d2d0-4b5d-96dc-1516363dad27',
    '2026-06-03'
  ),
  '42501',
  'new row violates row-level security policy for table "timesheet_entries"',
  'employee cannot insert an entry into a locked (submitted) week'
);

select * from finish();
rollback;
