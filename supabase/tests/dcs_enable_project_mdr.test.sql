-- Tests for DCS 1b.24: public.dcs_enable_project_mdr() — the "Enable DCS"
-- wizard's single transactional write (migration 20260925111841).
--
-- Follows dcs_create_project_mdr.test.sql (the direct predecessor): fixtures
-- as postgres inside this transaction (rolled back), then impersonation via
-- `authenticated` + request.jwt.claims, exactly like PostgREST.
--
-- What this file is for, in order of importance:
--   1. This function creates nothing — public.projects and public.sub_projects
--      are untouched by every call in this file (section 3, 5, 6).
--   2. Authorization — the in-body is_admin() check refuses a non-admin, and
--      the assertions read the MESSAGE, not only the SQLSTATE, for the same
--      reason as dcs_create_project_mdr's test: under SECURITY INVOKER an RLS
--      refusal carries the same 42501.
--   3. The two red proofs this task adds beyond the original function:
--      enabling a project twice (section 5), and enabling a project that
--      does not exist (section 6).
--   4. CPY numbering requires a client — the rule this task tightens versus
--      dcs_create_project_mdr's internal-only check (section 7).
--
-- Cast:
--   admin   tjezionekspam@gmail.com   profiles.role = admin
--   tymon   tjezionek2000@gmail.com   employee; made DC of PEJ below, so he
--                                     is the "DC of ANOTHER project" case
--   ernest  ejezionek@gmail.com       employee, plain member
-- Projects from seed:
--   PEJ (SC2602, pid 6c0909ce-…)      DCS already enabled (seed inserts its
--                                     mdr_settings row) — the "already
--                                     enabled" target, and no client_id.
--   SCMS-IT (pid 094e130b-…)          DCS NOT enabled, no client_id — the
--                                     happy-path and "no client" targets.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ============================================================
-- 0. Function shape (red without the migration)
-- ============================================================
select has_function('public', 'dcs_enable_project_mdr',
  'public.dcs_enable_project_mdr() exists');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dcs_enable_project_mdr'),
  false,
  'it is SECURITY INVOKER — every insert runs under the caller''s RLS');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dcs_enable_project_mdr'
      and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')),
  1::bigint,
  'it has a pinned search_path');

select ok(
  not has_function_privilege('anon',
    'public.dcs_enable_project_mdr(uuid, boolean, integer, integer, integer, numeric, jsonb)',
    'execute'),
  'anon cannot execute it');

select ok(
  has_function_privilege('authenticated',
    'public.dcs_enable_project_mdr(uuid, boolean, integer, integer, integer, numeric, jsonb)',
    'execute'),
  'authenticated can execute it — the server action calls it over /rest/v1/rpc/');

select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dcs_enable_project_mdr'),
  'uuid',
  'it returns the enabled project id');

-- ============================================================
-- Fixtures (as postgres, before switching roles).
--
-- b24c0000-… is a client with no project attached yet, used only by section 7
-- to prove CPY numbering IS allowed once a project has a client.
-- b241a000-… is a project with that client, DCS not enabled — created here
-- because seed has no such project (PEJ already has DCS; SCMS-IT has no
-- client).
-- ============================================================
insert into public.clients (id, name, code)
values ('b24c0000-0000-4000-8000-000000000001', '1b.24 Test Client', 'B24TST');

insert into public.projects (id, name, project_code, client_id, process_type, year)
values ('b241a000-0000-4000-8000-000000000001', '1b.24 Project With Client', 'SC9760',
        'b24c0000-0000-4000-8000-000000000001', 'project', 2027);

insert into dcs.project_roles (project_id, user_id, role)
select '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid, id, 'dc'
  from auth.users where email = 'tjezionek2000@gmail.com';

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com')     as ernest_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_project_id,       -- SCMS-IT, no DCS, no client
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_project_id,      -- PEJ, DCS already enabled
  'b241a000-0000-4000-8000-000000000001'::uuid as cliented_project_id, -- has a client, no DCS
  (select count(*) from public.projects)      as n_projects,
  (select count(*) from public.sub_projects)  as n_ctr,
  (select count(*) from dcs.mdr_settings)     as n_settings,
  (select count(*) from dcs.project_roles)    as n_roles;
grant select on t_fixture to authenticated;

-- ============================================================
-- 1. Signed out and a plain member: refused before any write.
-- ============================================================
set local role anon;
select throws_ok(
  $$select public.dcs_enable_project_mdr('094e130b-599b-4295-87fa-697fb71e7fc4'::uuid)$$,
  '42501', null,
  'anon cannot even execute the function (no EXECUTE grant)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select throws_ok(
  $$select public.dcs_enable_project_mdr('094e130b-599b-4295-87fa-697fb71e7fc4'::uuid)$$,
  '42501', null,
  'RED: a plain member is refused (42501)');
select throws_like(
  $$select public.dcs_enable_project_mdr('094e130b-599b-4295-87fa-697fb71e7fc4'::uuid)$$,
  '%only an administrator may enable DCS%',
  'and the refusal is the function''s own is_admin() check, not an anonymous policy denial');

-- ============================================================
-- 2. A DC of ANOTHER project (tymon is DC of PEJ) is refused too — being DC
--    somewhere grants nothing here, same 1a.16-style decision as creation.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select throws_ok(
  $$select public.dcs_enable_project_mdr('094e130b-599b-4295-87fa-697fb71e7fc4'::uuid)$$,
  '42501', null,
  'RED: a DC of another project is refused too (42501)');
select throws_like(
  $$select public.dcs_enable_project_mdr('094e130b-599b-4295-87fa-697fb71e7fc4'::uuid)$$,
  '%only an administrator may enable DCS%',
  'tymon hits the same in-body check — being DC of PEJ grants nothing on SCMS-IT');
reset role;

select is(
  (select count(*) from dcs.mdr_settings where project_id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid),
  0::bigint,
  'no mdr_settings row survived any of the refused calls on SCMS-IT');

-- ============================================================
-- 3. Happy path, as admin: SCMS-IT gets DCS enabled, public.projects and
--    public.sub_projects are untouched.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

create temp table t_enabled as
select public.dcs_enable_project_mdr(
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid,
  false,                        -- cpy_numbering (SCMS-IT has no client)
  5, 12, 9,                     -- cycles, deliberately NOT the 7/10/7 defaults
  800,                          -- budget_hours
  json_build_array(
    json_build_object('user_id', (select tymon_id from t_fixture), 'role', 'dc'),
    json_build_object('user_id', (select ernest_id from t_fixture), 'role', 'orig')
  )::jsonb
) as project_id;
grant select on t_enabled to authenticated;
reset role;

select is(
  (select project_id from t_enabled), '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid,
  'GREEN: the admin call returns the (existing) project id, unchanged');

select results_eq(
  $$select cpy_numbering, cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc, budget_hours, status::text
      from dcs.mdr_settings where project_id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid$$,
  $$values (false, 5, 12, 9, 800::numeric, 'active')$$,
  'dcs.mdr_settings carries the chosen cycles and budget; status defaults to active');

select set_eq(
  $$select role::text from dcs.project_roles where project_id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid$$,
  $$values ('dc'), ('orig')$$,
  'the roles are exactly the ones the wizard sent');

select is(
  (select count(*) from public.projects), (select n_projects from t_fixture),
  'criterion: public.projects row count is unchanged by enabling DCS');
select is(
  (select count(*) from public.sub_projects), (select n_ctr from t_fixture),
  'criterion: public.sub_projects row count is unchanged — enabling DCS creates no CTR codes');
select results_eq(
  $$select project_code, name, client_id, process_type, is_active
      from public.projects where id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid$$,
  $$values ('SCMS-IT', 'IT admin', null::uuid, 'internal'::public.project_process_type, true)$$,
  'the SCMS-IT project row itself is byte-for-byte what seed put there');

select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.mdr_settings' and action = 'INSERT'
      and record_id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid),
  1::bigint,
  'audit_log has the mdr_settings INSERT');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid),
  2::bigint,
  'audit_log has one row per project_roles INSERT');

-- ============================================================
-- 4. Acceptance criterion 1 continued: the newly-assigned DC reads the
--    project's team the way /dcs does — no filter in code, the database
--    decides (same shape as dcs_create_project_mdr.test.sql section 8).
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select ok(
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid in (select project_id from dcs.project_roles),
  'the DC''s unfiltered read of dcs.project_roles includes the newly-enabled project');
select is(
  (select count(*) from dcs.project_roles where project_id = '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid),
  2::bigint,
  'and the whole team, not just their own row');
reset role;

-- ============================================================
-- 5. RED: enabling the same project twice is refused, before any write, and
--    the message names the rule.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select throws_ok(
  $$select public.dcs_enable_project_mdr('6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid)$$,
  '23505', null,
  'RED: PEJ already has DCS enabled (seed) — a second enable is refused (23505)');
select throws_like(
  $$select public.dcs_enable_project_mdr('6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid)$$,
  '%DCS is already enabled for project%',
  'the message names the rule, not a bare PK violation');
select throws_ok(
  $$select public.dcs_enable_project_mdr('094e130b-599b-4295-87fa-697fb71e7fc4'::uuid)$$,
  '23505', null,
  'RED: SCMS-IT, enabled in section 3, cannot be enabled a second time either');
reset role;

select is(
  (select count(*) from dcs.mdr_settings where project_id = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid),
  1::bigint,
  'PEJ still has exactly one mdr_settings row — the repeat call changed nothing');

-- ============================================================
-- 6. RED: enabling a non-existent project is refused (P0002), before any
--    write, and public.projects gains no row (enabling never creates one).
-- ============================================================
set local role authenticated;
select throws_ok(
  $$select public.dcs_enable_project_mdr('00000000-0000-4000-8000-000000000099'::uuid)$$,
  'P0002', null,
  'RED: a project id that does not exist is refused (P0002)');
select throws_like(
  $$select public.dcs_enable_project_mdr('00000000-0000-4000-8000-000000000099'::uuid)$$,
  '%enabling DCS never creates a project%',
  'the message says enabling never creates — the point of this whole task');
reset role;

select is(
  (select count(*) from public.projects), (select n_projects from t_fixture),
  'public.projects is unchanged by the failed calls — n_projects already counts the fixture inserted above');
select is(
  (select count(*) from dcs.mdr_settings where project_id = '00000000-0000-4000-8000-000000000099'::uuid),
  0::bigint,
  'no mdr_settings row exists for the id that was never a project');

-- ============================================================
-- 7. CPY numbering: refused without a client (SCMS-IT), allowed with one
--    (the b241a000 fixture).
-- ============================================================
set local role authenticated;
select throws_ok(
  $$select public.dcs_enable_project_mdr('00000000-0000-4000-8000-000000000099'::uuid, true)$$,
  'P0002', null,
  'a non-existent project still fails on existence first, even with cpy_numbering true');

-- SCMS-IT was enabled without CPY in section 3; re-enabling is blocked by
-- section 5's rule, so the "no client" rejection is proven on a project that
-- is NOT yet enabled: the b241a000 fixture has a client, so prove the
-- opposite (no client) using a fresh, still-un-enabled project instead.
insert into public.projects (id, name, project_code, client_id, process_type, year)
values ('b241a000-0000-4000-8000-000000000002', '1b.24 No Client Yet', 'SC9761', null, 'tender', 2027);

select throws_ok(
  $$select public.dcs_enable_project_mdr('b241a000-0000-4000-8000-000000000002'::uuid, true)$$,
  '22023', null,
  'RED: CPY numbering on a project with no client is rejected (22023)');
select throws_like(
  $$select public.dcs_enable_project_mdr('b241a000-0000-4000-8000-000000000002'::uuid, true)$$,
  '%CPY numbering needs a client%',
  'the message says which rule was broken');
select is(
  (select count(*) from dcs.mdr_settings where project_id = 'b241a000-0000-4000-8000-000000000002'::uuid),
  0::bigint,
  'the rejected CPY attempt left no mdr_settings row at all — not even with cpy_numbering forced false');

select lives_ok(
  $$select public.dcs_enable_project_mdr('b241a000-0000-4000-8000-000000000001'::uuid, true)$$,
  'GREEN: CPY numbering is allowed once the project has a client');
reset role;

select results_eq(
  $$select cpy_numbering from dcs.mdr_settings where project_id = 'b241a000-0000-4000-8000-000000000001'::uuid$$,
  $$values (true)$$,
  'the cliented project now has cpy_numbering = true');

-- ============================================================
-- 8. Bad role payload: an unknown enum value reaches the database as a
--    database error, and leaves the project's DCS still disabled (mirrors
--    dcs_create_project_mdr.test.sql section 10's atomicity point — the
--    project_roles insert is the LAST statement, so a failure there must not
--    leave mdr_settings behind).
-- ============================================================
set local role authenticated;
select throws_ok(
  $$select public.dcs_enable_project_mdr('b241a000-0000-4000-8000-000000000002'::uuid, false, 7, 10, 7, null,
      '[{"user_id":"00000000-0000-4000-8000-000000000001","role":"boss"}]'::jsonb)$$,
  '22P02', null,
  'RED: a role outside dcs.project_role is rejected by the enum cast (22P02)');
reset role;

select is(
  (select count(*) from dcs.mdr_settings where project_id = 'b241a000-0000-4000-8000-000000000002'::uuid),
  0::bigint,
  'atomicity: the mdr_settings row inserted before the bad role did not survive — one call, one transaction');

-- ============================================================
-- 9. DCS-1b.24b: a project with a team assigned BEFORE DCS is enabled (the
--    panel at apps/dcs/lib/project-roles.ts writes dcs.project_roles
--    regardless of dcs.mdr_settings). Enabling must not fail when the
--    wizard's payload repeats a (user, role) pair that is already there —
--    it must skip that pair and add only the new one.
--
--    These assertions describe the FIXED behaviour (lives_ok, no duplicate,
--    exactly one new audit row) and are therefore RED against the migration
--    this file predates (20260925111841): its project_roles insert has no ON
--    CONFLICT, so the repeated (ernest, dc) pair trips the UNIQUE
--    (project_id, user_id, role) index (23505) and lives_ok fails on that
--    exception — the whole call, including the mdr_settings insert, rolls
--    back. They turn GREEN once 20260925131237 adds ON CONFLICT DO NOTHING.
-- ============================================================
insert into public.projects (id, name, project_code, client_id, process_type, year)
values ('b241a000-0000-4000-8000-000000000003', '1b.24b Project With Existing Team', 'SC9762', null, 'internal', 2027);

insert into dcs.project_roles (project_id, user_id, role)
select 'b241a000-0000-4000-8000-000000000003'::uuid, id, 'dc'::dcs.project_role
  from auth.users where email = 'ejezionek@gmail.com';

create temp table t_preteam as
select
  (select count(*) from dcs.project_roles
    where project_id = 'b241a000-0000-4000-8000-000000000003'::uuid) as n_roles_before,
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = 'b241a000-0000-4000-8000-000000000003'::uuid) as n_audit_before;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select lives_ok(
  format(
    $$select public.dcs_enable_project_mdr(
        'b241a000-0000-4000-8000-000000000003'::uuid, false, 7, 10, 7, null,
        json_build_array(
          json_build_object('user_id', %L, 'role', 'dc'),
          json_build_object('user_id', %L, 'role', 'orig')
        )::jsonb)$$,
    (select ernest_id from t_fixture), (select tymon_id from t_fixture)
  ),
  'GREEN: enabling succeeds even though the payload repeats ernest''s already-assigned dc row');
reset role;

select is(
  (select count(*) from dcs.mdr_settings where project_id = 'b241a000-0000-4000-8000-000000000003'::uuid),
  1::bigint,
  'GREEN: the mdr_settings row exists — the repeated pair no longer rolls back the whole call');
select is(
  (select count(*) from dcs.project_roles where project_id = 'b241a000-0000-4000-8000-000000000003'::uuid),
  (select n_roles_before from t_preteam) + 1,
  'GREEN: exactly one new role row (tymon/orig) — the repeated (ernest, dc) pair created no duplicate');
select set_eq(
  $$select role::text from dcs.project_roles where project_id = 'b241a000-0000-4000-8000-000000000003'::uuid$$,
  $$values ('dc'), ('orig')$$,
  'the pre-existing dc and the newly-added orig are both there, nothing else');

select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = 'b241a000-0000-4000-8000-000000000003'::uuid),
  (select n_audit_before from t_preteam) + 1,
  'audit_log gained exactly one INSERT row — the skipped (ernest, dc) pair produced none, the new (tymon, orig) pair produced one');

select * from finish();
rollback;
