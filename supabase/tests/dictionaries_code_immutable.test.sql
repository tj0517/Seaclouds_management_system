-- Tests for DCS 1a.15b: the BEFORE UPDATE trigger dictionaries_code_immutable
-- on dcs.dictionaries (migration 20260911091125) — `code` may never change,
-- for anybody, because from 1b.02 it is a segment of the SCL document number
-- (SC2601-SCL-RA-0012-EN, docs/00-glossary.md).
--
-- Follows dcs_profile_directory.test.sql (1a.14b, the newest file at the time
-- of writing): fixtures as postgres inside this transaction (rolled back),
-- then impersonation via authenticated + request.jwt.claims, exactly like
-- PostgREST.
--
-- The point of the impersonated half is that the trigger is NOT an RLS
-- refinement: both sessions in sections 4 and 5 are fully entitled to UPDATE
-- the row (admin via "Admins manage dictionaries", DC via "Doc controllers
-- update dictionaries" at aal2), and both are still refused the code change —
-- with 23001 (restrict_violation) raised by the trigger, not 42501 from a
-- policy.
--
-- Cast:
--   admin  tjezionekspam@gmail.com  profiles.role = admin
--   tymon  tjezionek2000@gmail.com  made DC of PEJ below
-- Project from seed: PEJ = 6c0909ce-….
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ============================================================
-- 0. Trigger and function shape (red without the migration)
-- ============================================================
select has_trigger('dcs', 'dictionaries', 'dictionaries_code_immutable',
  'dictionaries_code_immutable trigger is attached');
select is(
  (select tgtype from pg_trigger
    where tgrelid = 'dcs.dictionaries'::regclass and tgname = 'dictionaries_code_immutable'),
  19::smallint,
  'it is a BEFORE UPDATE FOR EACH ROW trigger (tgtype 19 = ROW|BEFORE|UPDATE), same shape as set_updated_at');
select is(
  (select tgfoid::regproc::text from pg_trigger
    where tgrelid = 'dcs.dictionaries'::regclass and tgname = 'dictionaries_code_immutable'),
  'forbid_dictionary_code_change', 'it executes public.forbid_dictionary_code_change()');
select has_function('public', 'forbid_dictionary_code_change',
  'public.forbid_dictionary_code_change() exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forbid_dictionary_code_change'),
  false,
  'the trigger function is SECURITY INVOKER — it adds no SECURITY DEFINER function to advisor lint 0029');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forbid_dictionary_code_change'
      and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')),
  1::bigint,
  'the trigger function has a pinned search_path (advisor lint 0011 baseline is zero)');
select ok(
  not has_function_privilege('anon', 'public.forbid_dictionary_code_change()', 'execute'),
  'anon cannot execute the trigger function (lint 0028)');
select ok(
  not has_function_privilege('authenticated', 'public.forbid_dictionary_code_change()', 'execute'),
  'authenticated cannot execute the trigger function — EXECUTE is checked when the trigger is created, not when it fires');

-- ============================================================
-- Fixtures (as postgres).
--
-- updated_at is seeded in the past ON PURPOSE. set_updated_at() assigns
-- now(), which inside a single transaction is the transaction timestamp and
-- therefore constant — so "did this statement bump updated_at?" can only be
-- asked against a value that predates the transaction. The INSERT itself is
-- safe to backdate: set_updated_at is a BEFORE *UPDATE* trigger only.
-- ============================================================
insert into dcs.project_roles (project_id, user_id, role)
select '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid, id, 'dc'
  from auth.users where email = 'tjezionek2000@gmail.com';

insert into dcs.dictionaries (id, dict_type, code, label, description, sort_order, updated_at)
values ('a15b0000-0000-4000-8000-000000000001', 'discipline', 'ZZ',
        'Immutability fixture', 'description that must survive a label edit', 10,
        timestamptz '2000-01-01 00:00:00+00');

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  'a15b0000-0000-4000-8000-000000000001'::uuid as row_id,
  timestamptz '2000-01-01 00:00:00+00' as backdated;
grant select on t_fixture to authenticated;

-- ============================================================
-- 1. postgres itself (superuser, table owner, RLS-exempt) is not exempt.
-- ============================================================
select throws_ok(
  $$update dcs.dictionaries set code = 'YY' where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  '23001', null,
  'RED: a direct SQL code change is rejected with 23001 (restrict_violation), even as postgres');
select throws_like(
  $$update dcs.dictionaries set code = code || '_X' where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  '%dcs.dictionaries.code is immutable%',
  'the error names the table and the column, and says why');
select is(
  (select code from dcs.dictionaries where id = (select row_id from t_fixture)),
  'ZZ', 'the stored code is unchanged after the rejected statements');
select is(
  (select updated_at from dcs.dictionaries where id = (select row_id from t_fixture)),
  (select backdated from t_fixture),
  'a rejected statement leaves no trace at all — updated_at still holds the backdated value');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.dictionaries' and record_id = (select row_id from t_fixture)
      and action = 'UPDATE'),
  0::bigint,
  'a rejected code change writes no audit_log row (the BEFORE trigger aborts before audit_dictionaries)');

-- ============================================================
-- 2. Why updateDictionaryEntry must send NO statement at all when nothing
--    changed (acceptance criterion 2b): a payload whose values all match the
--    stored ones still fires set_updated_at, while audit_trigger — which logs
--    only columns whose value actually differs — stays silent. updated_at is
--    the only witness that an UPDATE happened; audit_log cannot distinguish
--    "no UPDATE sent" from "full row resent unchanged".
-- ============================================================
update dcs.dictionaries set label = label, description = description, sort_order = sort_order
 where id = 'a15b0000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.dictionaries' and record_id = (select row_id from t_fixture)
      and action = 'UPDATE'),
  0::bigint,
  'a value-changing-nothing UPDATE writes no audit_log row — audit_log cannot prove "no UPDATE was sent"');
select is(
  (select updated_at from dcs.dictionaries where id = (select row_id from t_fixture)),
  now(),
  'the very same UPDATE still bumped updated_at to now() — which is why the app must issue no statement at all');

-- ============================================================
-- 3. A label edit — the operation the screen actually performs — still works,
--    and touches exactly one column in the trail.
-- ============================================================
select lives_ok(
  $$update dcs.dictionaries set label = 'Immutability fixture (renamed)'
     where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  'GREEN: a label-only UPDATE succeeds');
select results_eq(
  $$select field_name, old_value, new_value
      from public.audit_log
     where table_name = 'dcs.dictionaries' and record_id = 'a15b0000-0000-4000-8000-000000000001'
       and action = 'UPDATE'
     order by field_name$$,
  $$values ('label', '"Immutability fixture"'::jsonb, '"Immutability fixture (renamed)"'::jsonb)$$,
  'exactly one audit_log row, field_name = label — no row for description, sort_order or any other column');
select is(
  (select description from dcs.dictionaries where id = (select row_id from t_fixture)),
  'description that must survive a label edit',
  'the diff-only writer''s premise holds in the database: description is untouched by a label edit');

-- Re-stating the unchanged code in SET is fine: the trigger compares values
-- (IS DISTINCT FROM), it does not look at which columns the statement lists.
select lives_ok(
  $$update dcs.dictionaries set code = 'ZZ', label = 'Immutability fixture (renamed twice)'
     where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  'GREEN: restating the SAME code in SET is allowed — the trigger compares values, not column lists');

-- ============================================================
-- 4. No bypass for a session that IS entitled to update the row: admin.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$update dcs.dictionaries set label = 'renamed by admin'
     where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  'sanity: the admin session really may update this row (RLS lets it through)');
select throws_ok(
  $$update dcs.dictionaries set code = 'AA'
     where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  '23001', null,
  'RED: admin is refused the code change by the trigger (23001), not by a policy (42501) — no bypass');

-- ============================================================
-- 5. No bypass for the session the threat model is actually about: a DC at
--    aal2, whose PostgREST PATCH is exactly what the app-layer type
--    restriction cannot reach.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$update dcs.dictionaries set label = 'renamed by dc'
     where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  'sanity: the DC session at aal2 really may update this row (1a.09b + 1a.11)');
select throws_ok(
  $$update dcs.dictionaries set code = 'BB'
     where id = 'a15b0000-0000-4000-8000-000000000001'$$,
  '23001', null,
  'RED: a DC at aal2 is refused the code change by the trigger (23001) — the gap docs/deferred-tasks.md (bb) recorded');

reset role;
select is(
  (select code from dcs.dictionaries where id = (select row_id from t_fixture)),
  'ZZ', 'after every attempt above, the code is still the original one');

select * from finish();
rollback;
