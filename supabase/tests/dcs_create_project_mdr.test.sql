-- Tests for DCS 1a.17: public.dcs_create_project_mdr() — the Create Project
-- MDR wizard's single transactional write (migration 20260911103639).
--
-- Follows dictionaries_code_immutable.test.sql (1a.15b, the newest file at
-- the time of writing): fixtures as postgres inside this transaction (rolled
-- back), then impersonation via `authenticated` + request.jwt.claims, exactly
-- like PostgREST.
--
-- What this file is for, in order of importance:
--   1. Atomicity — a call that fails at its LAST step leaves zero rows in all
--      four tables (sections 5 and 6). The function is the transaction; a
--      client-side sequence of four PostgREST calls is not, which is the
--      whole reason CLAUDE.md forbids one.
--   2. Authorization — the in-body is_admin() check refuses a non-admin, and
--      the assertions read the MESSAGE, not only the SQLSTATE, because under
--      SECURITY INVOKER an RLS refusal carries the same 42501 and would
--      otherwise pass a test that the removed check should fail (section 4).
--   3. The happy path really writes all four kinds of row (section 3) and the
--      project's DC can then read it back the way /dcs does (section 8).
--
-- A note on the limits of the atomicity assertions here: pgTAP's throws_ok
-- runs its statement inside a plpgsql exception block, i.e. an implicit
-- subtransaction, so the rollback boundary is the CALL, not the function
-- body. That is still a real assertion — it fails for any implementation that
-- swallows the error (see the mutation described above section 5) — but it
-- cannot by itself distinguish "one function" from "four statements", because
-- inside one SQL transaction Postgres gives atomicity to both. The failure
-- mode the rule actually guards against is four separate PostgREST calls,
-- each its own transaction; that proof lives in the end-to-end script over
-- PostgREST, not in pgTAP, and is recorded in the PR.
--
-- Cast:
--   admin   tjezionekspam@gmail.com   profiles.role = admin
--   tymon   tjezionek2000@gmail.com   employee; made DC of PEJ below, so he
--                                     is the "DC of ANOTHER project" case
--   ernest  ejezionek@gmail.com       employee, plain member
-- Project from seed: PEJ = 6c0909ce-….
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- ============================================================
-- 0. Function shape (red without the migration)
-- ============================================================
select has_function('public', 'dcs_create_project_mdr',
  'public.dcs_create_project_mdr() exists');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dcs_create_project_mdr'),
  false,
  'it is SECURITY INVOKER — every insert runs under the caller''s RLS, and it adds nothing to advisor lint 0029');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dcs_create_project_mdr'
      and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')),
  1::bigint,
  'it has a pinned search_path (advisor lint 0011 baseline is zero)');

select ok(
  not has_function_privilege('anon',
    'public.dcs_create_project_mdr(text, text, public.project_process_type, integer, uuid, boolean, integer, integer, integer, numeric, jsonb, jsonb)',
    'execute'),
  'anon cannot execute it (lint 0028 baseline is zero)');

select ok(
  has_function_privilege('authenticated',
    'public.dcs_create_project_mdr(text, text, public.project_process_type, integer, uuid, boolean, integer, integer, integer, numeric, jsonb, jsonb)',
    'execute'),
  'authenticated can execute it — the server action calls it over /rest/v1/rpc/');

select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dcs_create_project_mdr'),
  'uuid',
  'it returns the new project id');

-- ============================================================
-- Fixtures (as postgres, before switching roles).
--
-- SC97xx codes match the ^SC\d{4}$ CHECK and collide with nothing in seed.
-- tymon becomes DC of PEJ so that section 4 can ask the question that
-- matters: a DC is not an admin, not even for a project they run.
-- ============================================================
insert into public.clients (id, name, code)
values ('a17c0000-0000-4000-8000-000000000001', '1a.17 Test Client', 'A17TST');

insert into dcs.project_roles (project_id, user_id, role)
select '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid, id, 'dc'
  from auth.users where email = 'tjezionek2000@gmail.com';

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com')     as ernest_id,
  'a17c0000-0000-4000-8000-000000000001'::uuid as client_id,
  (select count(*) from public.projects)      as n_projects,
  (select count(*) from dcs.mdr_settings)     as n_settings,
  (select count(*) from dcs.project_roles)    as n_roles,
  (select count(*) from public.sub_projects)  as n_ctr;
grant select on t_fixture to authenticated;

-- ============================================================
-- 1. Signed out: no session at all.
-- ============================================================
set local role anon;
select throws_ok(
  $$select public.dcs_create_project_mdr('SC9701', 'Anon Attempt', 'project', 2027)$$,
  '42501', null,
  'anon cannot even execute the function (no EXECUTE grant)');
reset role;

-- ============================================================
-- 2. A plain member and a DC-of-another-project are both refused, and the
--    refusal comes from the BODY, not from a policy.
--
--    This distinction is the point of section 4 below: under SECURITY
--    INVOKER, deleting the is_admin() check would still produce 42501 (RLS
--    on public.projects would raise it at the first insert), so a test that
--    only asserted the SQLSTATE would stay green against the very mutation
--    it exists to catch. The message is what tells the two apart.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select throws_ok(
  $$select public.dcs_create_project_mdr('SC9702', 'Member Attempt', 'project', 2027)$$,
  '42501', null,
  'RED: a plain member is refused (42501)');
select throws_like(
  $$select public.dcs_create_project_mdr('SC9702', 'Member Attempt', 'project', 2027)$$,
  '%only an administrator may create a project MDR%',
  'and the refusal is the function''s own is_admin() check, naming the rule — not an anonymous policy denial');

select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select throws_ok(
  $$select public.dcs_create_project_mdr('SC9703', 'DC Attempt', 'project', 2027)$$,
  '42501', null,
  'RED: a DC of another project is refused too (42501) — a dcs.project_roles row is per project, and the project does not exist yet');
select throws_like(
  $$select public.dcs_create_project_mdr('SC9703', 'DC Attempt', 'project', 2027)$$,
  '%only an administrator may create a project MDR%',
  'the DC hits the same in-body check — being DC of PEJ grants nothing here (1a.16 decision)');

reset role;
select is(
  (select count(*) from public.projects), (select n_projects from t_fixture),
  'no project row survived any of the refused calls');

-- ============================================================
-- 3. Happy path, as admin: all four kinds of row, in one call.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

create temp table t_created as
select public.dcs_create_project_mdr(
  'SC9710',
  'DCS 1a.17 Happy Path',
  'project',
  2027,
  'a17c0000-0000-4000-8000-000000000001'::uuid,
  true,                         -- cpy_numbering
  5, 12, 9,                     -- cycles, deliberately NOT the 7/10/7 defaults
  1500,                         -- budget_hours
  json_build_array(
    json_build_object('user_id', (select tymon_id from t_fixture), 'role', 'dc'),
    json_build_object('user_id', (select tymon_id from t_fixture), 'role', 'chk'),
    json_build_object('user_id', (select ernest_id from t_fixture), 'role', 'orig')
  )::jsonb,
  json_build_array(
    json_build_object('code', 'SC9710_CTR100', 'description', 'Project management'),
    json_build_object('code', 'SC9710_CTR200', 'description', '')
  )::jsonb
) as project_id;
grant select on t_created to authenticated;

reset role;

select isnt(
  (select project_id from t_created), null,
  'GREEN: the admin call returns a project id');

select results_eq(
  $$select name, project_code, process_type::text, year, client_id, is_active
      from public.projects where id = (select project_id from t_created)$$,
  $$values ('DCS 1a.17 Happy Path', 'SC9710', 'project', 2027,
            'a17c0000-0000-4000-8000-000000000001'::uuid, true)$$,
  'public.projects carries identification, client and is_active default');

select results_eq(
  $$select cpy_numbering, cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc,
           budget_hours, status::text
      from dcs.mdr_settings where project_id = (select project_id from t_created)$$,
  $$values (true, 5, 12, 9, 1500::numeric, 'active')$$,
  'dcs.mdr_settings carries the chosen cycles, budget and cpy_numbering; status defaults to active');

select is(
  (select count(*) from dcs.project_roles where project_id = (select project_id from t_created)),
  3::bigint,
  'three dcs.project_roles rows — one per (user, role) pair, so one person can hold two roles');

select set_eq(
  $$select role::text from dcs.project_roles where project_id = (select project_id from t_created)$$,
  $$values ('dc'), ('chk'), ('orig')$$,
  'the roles are exactly the ones the wizard sent');

select is(
  (select count(distinct assigned_by) from dcs.project_roles where project_id = (select project_id from t_created)),
  1::bigint,
  'assigned_by is set on every role row');
select is(
  (select distinct assigned_by from dcs.project_roles where project_id = (select project_id from t_created)),
  (select admin_id from t_fixture),
  'assigned_by is the calling admin, taken from the session (auth.uid()), not a parameter');

select results_eq(
  $$select code, description, tracking_type, is_active, is_deleted
      from public.sub_projects where project_id = (select project_id from t_created) order by code$$,
  $$values ('SC9710_CTR100', 'Project management', 'hours', true, false),
           ('SC9710_CTR200', null::text,            'hours', true, false)$$,
  'both CTR codes exist under this project; an empty description is stored as NULL, tracking_type takes its default');

-- The audit trail the existing trigger already produces — asserted, not
-- extended. dcs.mdr_settings is deliberately NOT in it (its PK is project_id,
-- not id; docs/02-data-model.md, and task 1a.17b).
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.projects' and record_id = (select project_id from t_created) and action = 'INSERT'),
  1::bigint,
  'audit_log has the projects INSERT (existing trigger, untouched)');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.project_roles' and action = 'INSERT'
      and project_id = (select project_id from t_created)),
  3::bigint,
  'audit_log has one row per project_roles INSERT');
select is(
  (select count(*) from public.audit_log where table_name = 'dcs.mdr_settings'),
  0::bigint,
  'audit_log has NOTHING for dcs.mdr_settings — not audited by audit_trigger(), which assumes PK id (task 1a.17b)');

-- ============================================================
-- 4. Defaults: 7/10/7 when the cycle arguments are omitted entirely.
-- ============================================================
set local role authenticated;
select lives_ok(
  $$select public.dcs_create_project_mdr('SC9711', 'DCS 1a.17 Defaults', 'tender', 2027)$$,
  'GREEN: the minimal call — code, name, process type, year — succeeds');
reset role;

select results_eq(
  $$select s.cycle_idc_to_ifr, s.cycle_ifr_to_retcom, s.cycle_retcom_to_ifc, s.cpy_numbering, s.budget_hours
      from dcs.mdr_settings s join public.projects p on p.id = s.project_id
     where p.project_code = 'SC9711'$$,
  $$values (7, 10, 7, false, null::numeric)$$,
  'omitted cycles fall back to 7/10/7 (docs/00-glossary.md), cpy_numbering to false, budget_hours to NULL');
select is(
  (select count(*) from dcs.project_roles r join public.projects p on p.id = r.project_id
    where p.project_code = 'SC9711'),
  0::bigint,
  'a project with no roles assigned is created anyway — "no DC" is a warning in the wizard, never a block');

-- ============================================================
-- 5. ATOMICITY: a duplicate CTR code inside the payload aborts the whole
--    creation, at the LAST step, leaving zero rows in every one of the four
--    tables.
--
--    Red proof performed for this assertion (restore afterwards): wrap the
--    sub_projects insert in the function body in
--        begin ... exception when unique_violation then null; end;
--    i.e. "handle" the duplicate instead of letting it abort. The call then
--    returns an id instead of raising, and this section fails three ways —
--    throws_ok gets no exception, and both counts move. That mutation is a
--    realistic one (it looks like error handling), which is why the counts
--    are asserted per table rather than trusting the raise alone.
-- ============================================================
create temp table t_before as
select
  (select count(*) from public.projects)     as n_projects,
  (select count(*) from dcs.mdr_settings)    as n_settings,
  (select count(*) from dcs.project_roles)   as n_roles,
  (select count(*) from public.sub_projects) as n_ctr;

set local role authenticated;
select throws_ok(
  $$select public.dcs_create_project_mdr(
      'SC9720', 'DCS 1a.17 Duplicate CTR', 'project', 2027,
      'a17c0000-0000-4000-8000-000000000001'::uuid, false, 7, 10, 7, null,
      '[]'::jsonb,
      '[{"code":"SC9720_CTR100"},{"code":"SC9720_CTR100"}]'::jsonb)$$,
  '23505', null,
  'RED: two identical CTR codes in one payload are rejected by sub_projects_project_id_code_key (23505)');
reset role;

select is((select count(*) from public.projects),     (select n_projects from t_before),
  'atomicity: zero public.projects rows added by the failed creation');
select is((select count(*) from dcs.mdr_settings),    (select n_settings from t_before),
  'atomicity: zero dcs.mdr_settings rows added by the failed creation');
select is((select count(*) from dcs.project_roles),   (select n_roles from t_before),
  'atomicity: zero dcs.project_roles rows added by the failed creation');
select is((select count(*) from public.sub_projects), (select n_ctr from t_before),
  'atomicity: zero public.sub_projects rows added by the failed creation — the step that failed is the last one');
select is(
  (select count(*) from public.projects where project_code = 'SC9720'),
  0::bigint,
  'the project the failed call named does not exist — not even partially');
select is(
  (select count(*) from public.audit_log where table_name = 'public.projects'
    and new_value ->> 'project_code' = 'SC9720'),
  0::bigint,
  'and the rolled-back INSERT left no audit_log row either');

-- ============================================================
-- 6. ATOMICITY, second shape: the row that fails is the FIRST one. An
--    invalid project_code is rejected by projects_project_code_format
--    (20260901082600) — the wizard validates the same pattern client-side,
--    but the database is what enforces it (acceptance criterion 5).
-- ============================================================
set local role authenticated;
select throws_ok(
  $$select public.dcs_create_project_mdr(
      'NOPE01', 'DCS 1a.17 Bad Code', 'project', 2027, null, false, 7, 10, 7, null,
      '[]'::jsonb, '[{"code":"NOPE01_CTR100"}]'::jsonb)$$,
  '23514', null,
  'RED: an off-format project_code is rejected by the CHECK (23514), not by the app');
reset role;

select is((select count(*) from public.projects),     (select n_projects from t_before),
  'atomicity: an invalid project_code leaves zero projects rows');
select is((select count(*) from public.sub_projects), (select n_ctr from t_before),
  'atomicity: … and zero sub_projects rows, though the CTR code in that payload was fine');

-- A duplicate project_code is the other first-step failure worth pinning:
-- unique_project_code, same 23505 as the CTR case but from a different
-- constraint, so the app must not map 23505 to "duplicate CTR" blindly.
set local role authenticated;
select throws_ok(
  $$select public.dcs_create_project_mdr('SC9710', 'DCS 1a.17 Code Clash', 'project', 2027)$$,
  '23505', null,
  'RED: reusing an existing project_code is rejected by unique_project_code (23505)');
reset role;
select is((select count(*) from public.projects where project_code = 'SC9710'), 1::bigint,
  'the original SC9710 project is untouched by the clashing attempt');

-- ============================================================
-- 7. The Internal invariant the function adds (approved for this task):
--    an internal project has no client and no CPY numbering. Stated in prose
--    in docs/02-data-model.md ("NULL = projekt wewnętrzny"), enforced nowhere
--    until now. Raises rather than silently coercing the caller's input.
-- ============================================================
set local role authenticated;
select throws_ok(
  $$select public.dcs_create_project_mdr('SC9730', 'Internal With Client', 'internal', 2027,
      'a17c0000-0000-4000-8000-000000000001'::uuid)$$,
  '22023', null,
  'RED: an internal project with a client_id is refused (22023)');
select throws_ok(
  $$select public.dcs_create_project_mdr('SC9731', 'Internal With CPY', 'internal', 2027, null, true)$$,
  '22023', null,
  'RED: an internal project with cpy_numbering = true is refused (22023) — the CPY track is the client''s numbering');
select throws_like(
  $$select public.dcs_create_project_mdr('SC9730', 'Internal With Client', 'internal', 2027,
      'a17c0000-0000-4000-8000-000000000001'::uuid)$$,
  '%an internal project has no client and no CPY numbering%',
  'the message says which rule was broken');

select lives_ok(
  $$select public.dcs_create_project_mdr('SC9732', 'Internal Done Right', 'internal', 2027)$$,
  'GREEN: an internal project with no client and no CPY numbering is created');
reset role;

select results_eq(
  $$select p.client_id, s.cpy_numbering
      from public.projects p join dcs.mdr_settings s on s.project_id = p.id
     where p.project_code = 'SC9732'$$,
  $$values (null::uuid, false)$$,
  'acceptance criterion 5: an internal project stores client_id = NULL and cpy_numbering = false');

-- A non-internal project may still have no client — "internal" is the only
-- process type the rule constrains, and client_id stays nullable for the rest.
set local role authenticated;
select lives_ok(
  $$select public.dcs_create_project_mdr('SC9733', 'Tender Without Client Yet', 'tender', 2027)$$,
  'GREEN: a non-internal project without a client is still allowed — client_id stays nullable');
reset role;

-- ============================================================
-- 8. Acceptance criterion 2: the DC assigned in step 4 reads the project
--    back, with team and cycle, the way /dcs does.
--
--    tymon holds only `dc`+`chk` on SC9710 (plus `dc` on PEJ from the
--    fixture). The two selects below are the two halves of
--    apps/dcs/lib/project-list.ts + app/(app)/page.tsx: the first has NO
--    filter in code at all — the database alone decides which project_roles
--    rows he sees (docs/03-conventions.md's rule about what a proof is).
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select tymon_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select ok(
  (select project_id from t_created) in (select project_id from dcs.project_roles),
  'the DC''s unfiltered read of dcs.project_roles includes the new project — this is what resolveProjectListFilter() consumes');

select results_eq(
  $$select name, project_code from public.projects
     where id in (select project_id from dcs.project_roles)
       and project_code = 'SC9710'$$,
  $$values ('DCS 1a.17 Happy Path', 'SC9710')$$,
  'criterion 2: the /dcs list query, run as the DC, returns the project');

select results_eq(
  $$select cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc
      from dcs.mdr_settings where project_id = (select project_id from t_created)$$,
  $$values (5, 12, 9)$$,
  'criterion 2: … and the DC reads its review cycle');

select is(
  (select count(*) from dcs.project_roles where project_id = (select project_id from t_created)),
  3::bigint,
  'criterion 2: … and the whole team, not just their own rows ("Project members read project roles")');

-- The DC is a reader here, not a creator: the 1a.16 decision, stated as a
-- test rather than only in prose.
select throws_ok(
  $$select public.dcs_create_project_mdr('SC9740', 'DC Of This Project', 'project', 2027)$$,
  '42501', null,
  'RED: being DC of the project they were just given does not let them create the NEXT one — creation stays admin-only');

-- ============================================================
-- 9. A plain non-member still sees nothing of the new project — the filter
--    is the database's, not the app's.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is(
  (select count(*) from dcs.project_roles where project_id = (select project_id from t_created)),
  3::bigint,
  'ernest holds `orig` on the project, so he sees the team too (is_project_member)');

reset role;

-- ============================================================
-- 10. Bad payload shapes reach the database as database errors, so the
--     server action has something specific to map.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select throws_ok(
  $$select public.dcs_create_project_mdr('SC9750', 'Bad Role', 'project', 2027, null, false, 7, 10, 7, null,
      '[{"user_id":"00000000-0000-4000-8000-000000000001","role":"boss"}]'::jsonb, '[]'::jsonb)$$,
  '22P02', null,
  'RED: a role outside dcs.project_role is rejected by the enum cast (22P02)');

select throws_ok(
  $$select public.dcs_create_project_mdr('SC9751', 'Unknown User', 'project', 2027, null, false, 7, 10, 7, null,
      '[{"user_id":"00000000-0000-4000-8000-000000000001","role":"dc"}]'::jsonb, '[]'::jsonb)$$,
  '23503', null,
  'RED: a user_id with no profiles row is rejected by the FK (23503)');

select throws_ok(
  $$select public.dcs_create_project_mdr('SC9752', 'Zero Cycle', 'project', 2027, null, false, 0, 10, 7)$$,
  '23514', null,
  'RED: a cycle of 0 days is rejected by mdr_settings_cycle_idc_to_ifr_positive (23514)');

select throws_ok(
  $$select public.dcs_create_project_mdr('SC9753', 'Negative Budget', 'project', 2027, null, false, 7, 10, 7, -1)$$,
  '23514', null,
  'RED: a negative budget is rejected by mdr_settings_budget_hours_non_negative (23514)');
reset role;

select is((select count(*) from public.projects where project_code in
    ('SC9750','SC9751','SC9752','SC9753','SC9720','SC9730','SC9731','SC9740','NOPE01')),
  0::bigint,
  'atomicity, all of section 10 and the refusals above: not one of those project codes exists');

select * from finish();
rollback;
