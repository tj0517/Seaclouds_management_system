-- Tests for DCS 1a.17b: dcs.mdr_settings under public.audit_trigger(), the
-- seventh audited table and the first one whose primary key is not `id`.
-- Migration 20260916145603_audit_mdr_settings.
--
-- What is actually at stake: brief §5.2 treats the review cycle 7/10/7 as a
-- project attribute documents inherit, and Phase 2 computes Planned dates from
-- it. Before this migration a cycle change left no trace but
-- mdr_settings.updated_at — "something changed at this hour", not who, not
-- which field, not from what to what. The red case is concrete, not
-- theoretical: with the trigger attached and the pre-1a.17b function, every
-- UPDATE on this table dies with 23502 on audit_log.record_id, because
-- record_id came from an `id` column this table does not have.
--
-- Pattern follows audit_log.test.sql (1a.08): fixtures as postgres inside a
-- rolled-back transaction, then impersonation via the authenticated role +
-- request.jwt.claims / request.headers, exactly like PostgREST.
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-… has an mdr_settings row, IT =
-- 094e130b-… deliberately has none (a missing row means "DCS does not run this
-- project"), so it is the clean slate for the INSERT and DELETE cases.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ============================================================
-- 1. Attachment, and the properties of the shared function that must NOT
--    have changed. audit_trigger() is replaced by this migration, so the
--    guards from 1a.08 are re-asserted here: a replaced SECURITY DEFINER
--    function that loses its pinned search_path, or gains EXECUTE for
--    authenticated, is a new advisor finding (lint 0029) dressed up as a
--    bug fix.
-- ============================================================
select has_trigger('dcs', 'mdr_settings', 'audit_mdr_settings',
  'audit trigger on dcs.mdr_settings (1a.17b)');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
    where t.tgrelid = 'dcs.mdr_settings'::regclass and t.tgname = 'audit_mdr_settings'),
  'AFTER INSERT OR DELETE OR UPDATE ON dcs\.mdr_settings FOR EACH ROW',
  'audit_mdr_settings is AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW — same shape as the other six');
select is(
  (select count(*) from pg_trigger t
    where t.tgfoid = 'public.audit_trigger()'::regprocedure and not t.tgisinternal),
  10::bigint,
  'audit_trigger() is attached to exactly ten tables (six before 1a.17b + dcs.mdr_settings, then dcs.documents/revisions/files in 1b.01)');
select is(
  (select count(*) from pg_trigger t
    where t.tgfoid = 'public.audit_trigger()'::regprocedure
      and t.tgrelid in ('public.timesheet_entries'::regclass,
                        'public.timesheet_submissions'::regclass,
                        'public.project_assignments'::regclass)),
  0::bigint,
  'audit_trigger() is still NOT attached to any TES table (TES/DCS isolation unchanged by 1a.17b)');
select is_definer('public', 'audit_trigger',
  'audit_trigger() is still SECURITY DEFINER after the replace');
select ok(
  exists (select 1 from pg_proc p, unnest(p.proconfig) c
           where p.oid = 'public.audit_trigger()'::regprocedure
             and c in ('search_path=', 'search_path=""')),
  'audit_trigger() still has search_path pinned to '''' after the replace');
select ok(
  not has_function_privilege('authenticated', 'public.audit_trigger()', 'execute'),
  'authenticated still cannot execute audit_trigger() (create or replace kept the 1a.08 revoke — no new lint 0029)');
select ok(
  not has_function_privilege('anon', 'public.audit_trigger()', 'execute'),
  'anon still cannot execute audit_trigger()');

-- ============================================================
-- 2. Fixtures
-- ============================================================
create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id;
grant select on t_fixture to authenticated;

-- seed.sql inserts the PEJ settings row after the migrations have run, so that
-- INSERT is itself audited — and is already proof that record_id resolves to
-- project_id for this table. Asserted rather than assumed, because everything
-- below counts rows on top of it.
select results_eq(
  $$select action, field_name, record_id, project_id
      from public.audit_log where table_name = 'dcs.mdr_settings'$$,
  $$values ('INSERT', null::text, '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid,
            '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid)$$,
  'baseline: the only mdr_settings entry is the seed INSERT, with record_id = project_id = the project');

-- ============================================================
-- 3. A no-op UPDATE writes nothing — even though set_updated_at() moves
--    updated_at on every UPDATE, no-op included. This is the pair of
--    assertions the whole `k <> 'updated_at'` filter exists for: without it
--    every save from the dialog would log a phantom change and the trail
--    would stop being readable. It runs FIRST because now() is frozen for
--    the life of a transaction — only the first UPDATE in this test can
--    demonstrate updated_at actually moving.
--
--    The statement re-sends every column at the value seed.sql gave it, which
--    is the exact shape apps/dcs/lib/project-mdr.ts avoids emitting: its
--    header note says audit_log cannot distinguish "no UPDATE sent" from
--    "full row resent unchanged". This proves the database half of that —
--    both cases write nothing.
-- ============================================================
create temp table t_before as
select (select count(*) from public.audit_log where table_name = 'dcs.mdr_settings') as n,
       (select updated_at from dcs.mdr_settings where project_id = (select pej_id from t_fixture)) as ts;

select lives_ok(
  $$update dcs.mdr_settings
       set cpy_numbering = false, cycle_idc_to_ifr = 7, cycle_ifr_to_retcom = 10,
           cycle_retcom_to_ifc = 7, budget_hours = 1200, status = 'active'
     where project_id = (select pej_id from t_fixture)$$,
  'an UPDATE re-sending every column at the value it already holds succeeds');
select is(
  (select count(*) from public.audit_log where table_name = 'dcs.mdr_settings'),
  (select n from t_before),
  'no-op UPDATE writes ZERO audit rows');
select cmp_ok(
  (select updated_at from dcs.mdr_settings where project_id = (select pej_id from t_fixture)),
  '>', (select ts from t_before),
  'sanity: the no-op UPDATE really did fire set_updated_at() and move updated_at — the zero above is the filter working, not a trigger that never fired');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.mdr_settings' and field_name = 'updated_at'),
  0::bigint,
  'updated_at never appears as a field_name for dcs.mdr_settings');

-- ============================================================
-- 4. The criterion of this task: a cycle change leaves one row per column
--    that actually changed, and the row is traceable to the project.
-- ============================================================
update dcs.mdr_settings set cycle_idc_to_ifr = 3 where project_id = (select pej_id from t_fixture);

select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.mdr_settings' and action = 'UPDATE'),
  1::bigint,
  'a one-column cycle change writes exactly one audit row');
select results_eq(
  $$select record_id, project_id, field_name, old_value, new_value, user_id, ip
      from public.audit_log
     where table_name = 'dcs.mdr_settings' and action = 'UPDATE'$$,
  $$values ('6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid,
            '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid,
            'cycle_idc_to_ifr', '7'::jsonb, '3'::jsonb, null::uuid, null::text)$$,
  'cycle_idc_to_ifr 7 → 3: record_id = project_id = the project, old/new values recorded, sessionless write leaves user_id and ip NULL');

-- ============================================================
-- 5. A multi-column edit: one row per column that changed, nothing for the
--    columns the dialog re-sent unchanged. This is acceptance criterion 1
--    of the task, at the level the database can prove it.
-- ============================================================
update dcs.mdr_settings
   set cycle_ifr_to_retcom = 14, budget_hours = 900, status = 'closed',
       cpy_numbering = cpy_numbering, cycle_retcom_to_ifc = cycle_retcom_to_ifc
 where project_id = (select pej_id from t_fixture);

select bag_eq(
  $$select field_name, old_value, new_value from public.audit_log
     where table_name = 'dcs.mdr_settings' and action = 'UPDATE'
       and field_name <> 'cycle_idc_to_ifr'$$,
  $$values ('cycle_ifr_to_retcom', '10'::jsonb, '14'::jsonb),
           ('budget_hours',        '1200'::jsonb, '900'::jsonb),
           ('status',              '"active"'::jsonb, '"closed"'::jsonb)$$,
  'three changed columns → three rows; cpy_numbering and cycle_retcom_to_ifc were re-sent unchanged and logged nothing');

-- ============================================================
-- 6. INSERT and DELETE: one row each, whole row in new_value/old_value,
--    field_name NULL. IT has no settings row, so it is a clean slate.
-- ============================================================
insert into dcs.mdr_settings (project_id, cycle_idc_to_ifr, budget_hours)
values ((select it_id from t_fixture), 5, 40);

select results_eq(
  $$select action, field_name, record_id, project_id, old_value,
           new_value ->> 'cycle_idc_to_ifr', new_value ->> 'status'
      from public.audit_log
     where table_name = 'dcs.mdr_settings'
       and record_id = '094e130b-599b-4295-87fa-697fb71e7fc4'$$,
  $$values ('INSERT', null::text, '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid,
            '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid, null::jsonb, '5', 'active')$$,
  'INSERT: one row, field_name NULL, whole row in new_value, record_id = project_id');

delete from dcs.mdr_settings where project_id = (select it_id from t_fixture);

select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.mdr_settings' and action = 'DELETE'),
  1::bigint,
  'DELETE writes exactly one audit row');
select results_eq(
  $$select field_name, record_id, new_value,
           old_value ->> 'cycle_idc_to_ifr', old_value ->> 'budget_hours'
      from public.audit_log
     where table_name = 'dcs.mdr_settings' and action = 'DELETE'$$,
  $$values (null::text, '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid, null::jsonb, '5', '40')$$,
  'DELETE: field_name NULL, whole row in old_value, record_id still resolves from the deleted row');

-- ============================================================
-- 7. The actor. A cycle edit through EditProjectDialog arrives as an admin
--    PostgREST session; the trail is worth nothing if it cannot name who
--    made the change. Same impersonation as audit_log.test.sql section 2.
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

update dcs.mdr_settings set cycle_retcom_to_ifc = 21 where project_id = (select pej_id from t_fixture);

select results_eq(
  $$select field_name, old_value, new_value, user_id, ip, project_id
      from public.audit_log
     where table_name = 'dcs.mdr_settings' and user_id is not null$$,
  $$values ('cycle_retcom_to_ifc', '7'::jsonb, '21'::jsonb,
            (select admin_id from t_fixture), '203.0.113.7',
            '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid)$$,
  'admin session: the cycle change carries the real user_id and the client IP from x-forwarded-for');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.mdr_settings' and user_id = (select admin_id from t_fixture)),
  1::bigint,
  'exactly one row attributed to the admin — the edit, not a cascade');

reset role;

-- ============================================================
-- 8. Regression inside this file: the six tables that already had an `id`
--    must still key on it. The coalesce added in 1a.17b returns its first
--    argument for them, and this proves it on the two shapes that matter —
--    a table whose project scope is its own id (public.projects) and one
--    that carries a project_id column alongside an id (dcs.project_roles).
-- ============================================================
update public.projects set year = 2031 where id = (select pej_id from t_fixture);
select results_eq(
  $$select record_id, project_id, field_name, new_value
      from public.audit_log
     where table_name = 'public.projects' and action = 'UPDATE'
       and record_id = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'$$,
  $$values ('6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid,
            '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid, 'year', '2031'::jsonb)$$,
  'regression: public.projects still keys record_id on its own id, project_id unchanged');

-- Scoped to field_name = 'label': migration 20260916104238 rewrote 24
-- dictionary descriptions and those UPDATE rows are in the log already.
update dcs.dictionaries set label = 'Regression probe'
 where dict_type = 'doc_type' and code = 'RA';
select results_eq(
  $$select record_id = (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
           project_id, field_name
      from public.audit_log
     where table_name = 'dcs.dictionaries' and action = 'UPDATE' and field_name = 'label'$$,
  $$values (true, null::uuid, 'label')$$,
  'regression: dcs.dictionaries still keys record_id on its id, and a global dictionary still logs project_id NULL');

select * from finish();
rollback;
