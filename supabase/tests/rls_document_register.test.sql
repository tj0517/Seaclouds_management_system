-- Tests for DCS 1b.01: dcs.documents / dcs.revisions / dcs.files — shape,
-- constraints, the four guard triggers, the audit attachment and RLS.
-- Migration 20260917130035_create_dcs_document_register.
--
-- Pattern follows rls_dictionaries.test.sql (the newest RLS test) and
-- audit_mdr_settings.test.sql: fixtures as postgres inside this transaction
-- (rolled back at the end), then impersonation via `set local role
-- authenticated` + request.jwt.claims carrying an explicit aal, exactly like
-- PostgREST.
--
-- Two things this file is deliberately built around:
--
--   * "Only the DC may move a number" is a TRIGGER, not a policy — a policy
--     sees either the old row or the new one, never both. So the aal1 proof
--     needs a caller who passes the RLS UPDATE policy and is still refused:
--     that is `both_user`, who holds orig AND dc on the project. A dc-only
--     caller at aal1 (dc_user) is stopped one layer earlier, by RLS, and both
--     layers are asserted separately so a future change cannot silently move
--     the refusal from one to the other.
--
--   * Every "this user sees / does not see" assertion is a bare count(*) with
--     no WHERE (docs/03-conventions.md): the difference between users has to
--     be made by the database, not by the query.
--
-- Cast:
--   admin      tjezionekspam@gmail.com   profiles.role = admin
--   ernest     ejezionek@gmail.com       TES member of PEJ (project_assignments),
--                                        no DCS role at all — proves is_project_member
--                                        still covers plain TES membership
--   dc_user    created below             dc of PEJ
--   orig_user  created below             orig of PEJ
--   both_user  created below             orig AND dc of PEJ
--   viewer     created below             view of PEJ
--   outsider   created below             nothing anywhere
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-… has an mdr_settings row with
-- cpy_numbering = false; IT = 094e130b-… has no mdr_settings row at all, which
-- is the second branch of the CPY guard.
begin;
create extension if not exists pgtap with schema extensions;
select plan(106);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select has_table('dcs', 'documents', 'table dcs.documents exists');
select has_table('dcs', 'revisions', 'table dcs.revisions exists');
select has_table('dcs', 'files', 'table dcs.files exists');

select columns_are('dcs', 'documents',
  array['id', 'project_id', 'scl_doc_number', 'cpy_doc_number', 'title',
        'doc_type_id', 'discipline_id', 'area_id', 'language_id', 'workflow_status_id',
        'originator_id', 'checker_id', 'approver_id', 'ctr_code', 'budget_hours',
        'current_revision_id', 'created_at', 'updated_at',
        'doc_type_dict_type', 'discipline_dict_type', 'area_dict_type',
        'language_dict_type', 'workflow_status_dict_type'],
  'documents: the 1b.01 columns, including the five generated dict_type discriminators');
select columns_are('dcs', 'revisions',
  array['id', 'document_id', 'project_id', 'scl_revision', 'cpy_revision',
        'step_id', 'reason_for_issue', 'revision_date', 'acceptance_code_id',
        'status_id', 'created_by', 'created_at', 'updated_at',
        'step_dict_type', 'acceptance_code_dict_type', 'status_dict_type'],
  'revisions: the 1b.01 columns, including project_id and the three discriminators');
select columns_are('dcs', 'files',
  array['id', 'revision_id', 'project_id', 'file_name', 'original_name',
        'storage_path', 'file_kind', 'sort_order', 'size_bytes', 'mime_type',
        'uploaded_by', 'uploaded_at'],
  'files: the 1b.01 columns, including project_id');

select col_is_pk('dcs', 'documents', 'id', 'documents.id is the PK (audit_trigger needs one)');
select col_is_pk('dcs', 'revisions', 'id', 'revisions.id is the PK');
select col_is_pk('dcs', 'files', 'id', 'files.id is the PK');

select col_not_null('dcs', 'documents', 'project_id', 'documents.project_id is NOT NULL');
select col_not_null('dcs', 'revisions', 'project_id', 'revisions.project_id is NOT NULL (a column, not a join — audit_log scope depends on it)');
select col_not_null('dcs', 'files', 'project_id', 'files.project_id is NOT NULL (same reason)');
select col_not_null('dcs', 'documents', 'doc_type_id', 'documents.doc_type_id is NOT NULL');
select col_not_null('dcs', 'documents', 'discipline_id', 'documents.discipline_id is NOT NULL');
select col_not_null('dcs', 'documents', 'area_id', 'documents.area_id is NOT NULL');
select col_not_null('dcs', 'documents', 'language_id', 'documents.language_id is NOT NULL');
select col_not_null('dcs', 'documents', 'workflow_status_id', 'documents.workflow_status_id is NOT NULL');
select col_is_null('dcs', 'documents', 'cpy_doc_number', 'documents.cpy_doc_number is nullable (no CPY number until the client issues one)');
select col_is_null('dcs', 'files', 'file_name', 'files.file_name is nullable until 1b.09 generates it');

select col_is_unique('dcs', 'documents', array['scl_doc_number'],
  'scl_doc_number is unique globally');
select col_is_unique('dcs', 'documents', array['project_id', 'cpy_doc_number'],
  '(project_id, cpy_doc_number) is unique — the CPY number is unique per project');
select col_is_unique('dcs', 'revisions', array['document_id', 'scl_revision'],
  '(document_id, scl_revision) is unique');
select col_is_unique('dcs', 'dictionaries', array['id', 'dict_type'],
  '1b.01 added UNIQUE (id, dict_type) on dcs.dictionaries — the target of the composite dictionary FKs');

-- Every FK covered by an index over its FULL column list, in FK order.
--
-- This assertion was weaker in 1b.01: it compared only (indkey)[0] against
-- conkey[1], i.e. the leading column. Eleven composite FKs on these tables had
-- an index on their first column only, passed that test, and were then flagged
-- by the performance advisor (unindexed_foreign_keys 10 → 21 on scl-dev after
-- 1b.01 merged). The advisor was right and the test was wrong, so the test now
-- checks what the advisor checks. Fixed by 20260917… fix_dcs_composite_fk_indexes.
--
-- is_empty rather than a count, so a failure prints WHICH foreign keys are
-- uncovered instead of just how many. indnkeyatts excludes INCLUDE columns
-- from counting as coverage, and indpred excludes partial indexes, which do
-- not cover every row.
select is_empty(
  $$select c.conrelid::regclass::text || '.' || c.conname as uncovered_fk
      from pg_constraint c
     where c.conrelid in ('dcs.documents'::regclass, 'dcs.revisions'::regclass, 'dcs.files'::regclass)
       and c.contype = 'f'
       and not exists (
         select 1
           from pg_index i
          where i.indrelid = c.conrelid
            and i.indisvalid
            and i.indpred is null
            and i.indnkeyatts >= array_length(c.conkey, 1)
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])
     order by 1$$,
  'every FK on the three tables has an index whose leading columns are exactly the FK''s full column list, in FK order (advisor unindexed_foreign_keys)');

select ok(
  (select relrowsecurity from pg_class where oid = 'dcs.documents'::regclass),
  'RLS is enabled on dcs.documents');
select ok(
  (select relrowsecurity from pg_class where oid = 'dcs.revisions'::regclass),
  'RLS is enabled on dcs.revisions');
select ok(
  (select relrowsecurity from pg_class where oid = 'dcs.files'::regclass),
  'RLS is enabled on dcs.files');

select policies_are('dcs', 'documents',
  array['Project members read documents', 'Admins manage documents',
        'Originators insert documents', 'Originators update documents',
        'Doc controllers insert documents', 'Doc controllers update documents'],
  'documents: member SELECT, admin ALL, and separate ORIG / DC write policies');
select policies_are('dcs', 'revisions',
  array['Project members read revisions', 'Admins manage revisions',
        'Originators insert revisions', 'Originators update revisions',
        'Doc controllers insert revisions', 'Doc controllers update revisions'],
  'revisions: the same six policies');
select policies_are('dcs', 'files',
  array['Project members read files', 'Admins manage files',
        'Originators insert files', 'Originators update files',
        'Doc controllers insert files', 'Doc controllers update files'],
  'files: the same six policies');

select is(
  (select count(*) from pg_policies
    where schemaname = 'dcs' and tablename in ('documents', 'revisions', 'files')
      and cmd = 'DELETE'),
  0::bigint,
  'no dedicated DELETE policy on any of the three — deletion stays inside the admin ALL policy (Void, not delete)');
select is(
  (select count(*) from pg_policies
    where schemaname = 'dcs' and tablename in ('documents', 'revisions', 'files')
      and policyname like 'Doc controllers%'
      and (with_check like '%aal2%')),
  6::bigint,
  'all six DC write policies require aal2 in WITH CHECK');
select is(
  (select count(*) from pg_policies
    where schemaname = 'dcs' and tablename in ('documents', 'revisions', 'files')
      and policyname like 'Originators%'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%aal%'),
  0::bigint,
  'no Originator policy mentions aal — a second factor is required of the DC, not of everyone');
select is(
  (select count(*) from pg_policies
    where schemaname = 'dcs' and tablename in ('documents', 'revisions', 'files')
      and cmd in ('SELECT', 'ALL')
      and (qual is null or qual in ('true', '(true)'))),
  0::bigint,
  'no SELECT/ALL policy on the three tables has a true/NULL USING clause');

-- ============================================================
-- 2. Triggers and the functions behind them
-- ============================================================
select has_trigger('dcs', 'documents', 'documents_scl_number_immutable', 'documents_scl_number_immutable is attached');
select has_trigger('dcs', 'documents', 'documents_numbering_dc_only', 'documents_numbering_dc_only is attached');
select has_trigger('dcs', 'documents', 'documents_cpy_numbering', 'documents_cpy_numbering is attached');
select has_trigger('dcs', 'documents', 'documents_ctr_code_project', 'documents_ctr_code_project is attached');
select has_trigger('dcs', 'revisions', 'revisions_numbering_dc_only', 'revisions_numbering_dc_only is attached');
select has_trigger('dcs', 'revisions', 'revisions_cpy_numbering', 'revisions_cpy_numbering is attached');
select has_trigger('dcs', 'documents', 'set_updated_at', 'documents has set_updated_at');
select has_trigger('dcs', 'revisions', 'set_updated_at', 'revisions has set_updated_at');
select hasnt_trigger('dcs', 'files', 'set_updated_at', 'files has no set_updated_at — uploaded_at is its only timestamp');

select has_trigger('dcs', 'documents', 'audit_documents', 'audit_documents is attached');
select has_trigger('dcs', 'revisions', 'audit_revisions', 'audit_revisions is attached');
select has_trigger('dcs', 'files', 'audit_files', 'audit_files is attached');
select is(
  (select count(*) from pg_trigger t
    where t.tgfoid = 'public.audit_trigger()'::regprocedure and not t.tgisinternal),
  10::bigint,
  'audit_trigger() is attached to exactly ten tables (seven before 1b.01 + the three new ones)');
select is(
  (select count(*) from pg_trigger t
    where t.tgfoid = 'public.audit_trigger()'::regprocedure
      and t.tgrelid in ('public.timesheet_entries'::regclass,
                        'public.timesheet_submissions'::regclass,
                        'public.project_assignments'::regclass)),
  0::bigint,
  'audit_trigger() is still not attached to any TES table (isolation unchanged by 1b.01)');

-- The four new functions: search_path pinned (advisor 0011), no SECURITY
-- DEFINER (so advisor 0029 gains nothing), no EXECUTE for any API role
-- (advisor 0028, guarded globally by advisor_grants.test.sql).
select ok(
  (select bool_and(p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('public.forbid_scl_doc_number_change()'::regprocedure,
                    'public.enforce_dc_only_numbering()'::regprocedure,
                    'public.enforce_cpy_numbering_enabled()'::regprocedure,
                    'public.enforce_document_ctr_code_project()'::regprocedure)),
  'all four 1b.01 trigger functions have search_path pinned to ''''');
select ok(
  (select bool_and(not p.prosecdef)
     from pg_proc p
    where p.oid in ('public.forbid_scl_doc_number_change()'::regprocedure,
                    'public.enforce_dc_only_numbering()'::regprocedure,
                    'public.enforce_cpy_numbering_enabled()'::regprocedure,
                    'public.enforce_document_ctr_code_project()'::regprocedure)),
  'none of the four is SECURITY DEFINER — 1b.01 adds nothing to advisor lint 0029');
select ok(
  (select bool_and(not has_function_privilege(r, p.oid, 'execute'))
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid in ('public.forbid_scl_doc_number_change()'::regprocedure,
                    'public.enforce_dc_only_numbering()'::regprocedure,
                    'public.enforce_cpy_numbering_enabled()'::regprocedure,
                    'public.enforce_document_ctr_code_project()'::regprocedure)),
  'no API role can execute any of the four (EXECUTE is checked at CREATE TRIGGER, not at fire time)');

-- ============================================================
-- 3. Fixtures
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, 'x', now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(),
  '', '', '', '', '', '', '', 0
from (values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid, 'dc-1b01@example.com', 'DC user'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid, 'orig-1b01@example.com', 'Originator'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'::uuid, 'both-1b01@example.com', 'Originator and DC'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'::uuid, 'viewer-1b01@example.com', 'Viewer'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5'::uuid, 'outsider-1b01@example.com', 'Outsider')
) as u(id, email, name);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid as dc_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid as orig_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'::uuid as both_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'::uuid as viewer_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5'::uuid as outsider_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as doc_type_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as discipline_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as language_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as status_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC') as step_id,
  (select id from public.sub_projects where code = 'SC2602_CTR122') as ctr_pej_id,
  (select id from public.sub_projects where code = 'timesheet') as ctr_it_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid as doc1_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid as doc2_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'::uuid as rev1_id;
grant select on t_fixture to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select f.pej_id, u.user_id, u.role::dcs.project_role
  from t_fixture f
 cross join lateral (values
   (f.dc_id, 'dc'), (f.orig_id, 'orig'),
   (f.both_id, 'orig'), (f.both_id, 'dc'),
   (f.viewer_id, 'view')
 ) as u(user_id, role);

-- One document and one revision on PEJ, written as postgres so the RLS
-- sections start from a known state.
insert into dcs.documents (
  id, project_id, scl_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id, ctr_code)
select doc1_id, pej_id, 'SC2602-SCL-RA-0001-EN', 'Fixture document',
       doc_type_id, discipline_id, area_id, language_id, status_id, ctr_pej_id
  from t_fixture;

insert into dcs.revisions (id, document_id, project_id, scl_revision, step_id, status_id)
select rev1_id, doc1_id, pej_id, 'A', step_id, status_id from t_fixture;

insert into dcs.files (revision_id, project_id, file_kind, original_name)
select rev1_id, pej_id, 'original', 'fixture.pdf' from t_fixture;

-- ============================================================
-- 4. Constraints and guard triggers, as postgres — RLS is not what is being
--    tested here, so a superuser proves these hold for EVERY caller.
-- ============================================================

-- RED: a dictionary FK pointing at a row of the wrong dict_type.
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'RED-DICT', 't', doc_type_id, language_id, area_id, language_id, status_id from t_fixture$$,
  '23503', null,
  'RED: discipline_id pointing at a language dictionary row is rejected (23503, composite FK)');
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id)
    select doc1_id, pej_id, 'RED', status_id, status_id from t_fixture$$,
  '23503', null,
  'RED: step_id pointing at a workflow_status row is rejected (23503) — workflow_step and workflow_status share their codes, so this is the realistic mix-up');
select lives_ok(
  $$insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id, acceptance_code_id)
    select doc1_id, pej_id, 'B', step_id, status_id,
           (select id from dcs.dictionaries where dict_type = 'acceptance_code' and code = '1')
      from t_fixture$$,
  'GREEN: the matching dict_types are accepted, acceptance_code included');

-- RED: ctr_code belonging to another project.
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id, ctr_code)
    select pej_id, 'RED-CTR', 't', doc_type_id, discipline_id, area_id, language_id, status_id, ctr_it_id from t_fixture$$,
  '23503', null,
  'RED: ctr_code pointing at a sub-project of another project is rejected (23503)');

-- RED: current_revision_id belonging to another document.
insert into dcs.documents (
  id, project_id, scl_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select doc2_id, pej_id, 'SC2602-SCL-RA-0002-EN', 'Second document',
       doc_type_id, discipline_id, area_id, language_id, status_id
  from t_fixture;
select throws_ok(
  $$update dcs.documents set current_revision_id = (select rev1_id from t_fixture)
     where id = (select doc2_id from t_fixture)$$,
  '23503', null,
  'RED: current_revision_id pointing at another document''s revision is rejected (23503, composite FK)');
select lives_ok(
  $$update dcs.documents set current_revision_id = (select rev1_id from t_fixture)
     where id = (select doc1_id from t_fixture)$$,
  'GREEN: current_revision_id pointing at a revision of the same document is accepted');

-- RED: duplicates.
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'SC2602-SCL-RA-0001-EN', 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  '23505', null,
  'RED: duplicate scl_doc_number is rejected (23505)');

-- RED: scl_doc_number is immutable — for postgres too, no role bypass.
select throws_ok(
  $$update dcs.documents set scl_doc_number = 'SC2602-SCL-RA-9999-EN'
     where id = (select doc1_id from t_fixture)$$,
  '23001', null,
  'RED: UPDATE of scl_doc_number is rejected (23001) even as postgres — no role bypass');
select is(
  (select scl_doc_number from dcs.documents where id = (select doc1_id from t_fixture)),
  'SC2602-SCL-RA-0001-EN',
  'the rejected UPDATE left the number untouched');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and field_name = 'scl_doc_number'),
  0::bigint,
  'a rejected number change writes no audit_log row (BEFORE trigger, so nothing reaches the AFTER trigger)');

-- RED: CPY numbers on a project that does not run CPY numbering.
-- PEJ has an mdr_settings row with cpy_numbering = false.
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'RED-CPY-1', 'CLIENT-001', 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  '23514', null,
  'RED: non-NULL cpy_doc_number on a project with cpy_numbering = false is rejected (23514)');
-- IT has NO mdr_settings row at all — the case the task asked to define.
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'RED-CPY-2', 'CLIENT-002', 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  '23514', null,
  'RED: non-NULL cpy_doc_number on a project with NO mdr_settings row is rejected (23514) — a missing row is treated as cpy_numbering = false');
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, scl_revision, cpy_revision, step_id, status_id)
    select doc1_id, pej_id, 'C', 'CLIENT-REV', step_id, status_id from t_fixture$$,
  '23514', null,
  'RED: non-NULL cpy_revision on a project with cpy_numbering = false is rejected (23514)');
select lives_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'SCMS-IT-SCL-RA-0001-EN', null, 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  'GREEN: a NULL cpy_doc_number is fine on a project with no mdr_settings row');

-- With CPY numbering switched on, the CPY number is accepted and is unique
-- per project. (The switch itself is an ordinary mdr_settings update.)
update dcs.mdr_settings set cpy_numbering = true where project_id = (select pej_id from t_fixture);
select lives_ok(
  $$update dcs.documents set cpy_doc_number = 'CLIENT-001' where id = (select doc1_id from t_fixture)$$,
  'GREEN: with cpy_numbering = true the CPY number is accepted — and a sessionless caller (postgres: migration, seed, psql) is exempt from the DC check, which is what makes this statement possible at all');
select throws_ok(
  $$update dcs.documents set cpy_doc_number = 'CLIENT-001' where id = (select doc2_id from t_fixture)$$,
  '23505', null,
  'RED: duplicate (project_id, cpy_doc_number) is rejected (23505)');
select lives_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'SCMS-IT-SCL-RA-0002-EN', null, 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  'GREEN: a second NULL cpy_doc_number in the same project is fine — the unique constraint does not collapse NULLs');

-- files
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_kind) select rev1_id, pej_id, 'sketch' from t_fixture$$,
  '23514', null,
  'RED: a file_kind outside the CHECK list is rejected (23514)');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_kind) select rev1_id, it_id, 'original' from t_fixture$$,
  '23503', null,
  'RED: a file whose project_id is not its revision''s is rejected (23503, composite FK)');
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id)
    select doc1_id, it_id, 'Z', step_id, status_id from t_fixture$$,
  '23503', null,
  'RED: a revision whose project_id is not its document''s is rejected (23503, composite FK)');
select bag_eq(
  $$select file_kind from (values ('original'), ('rendition'), ('attachment'), ('comment_sheet')) v(file_kind)
     where exists (select 1 from pg_constraint c
                    where c.conrelid = 'dcs.files'::regclass and c.conname = 'files_file_kind_check'
                      and pg_get_constraintdef(c.oid) like '%' || v.file_kind || '%')$$,
  $$values ('original'), ('rendition'), ('attachment'), ('comment_sheet')$$,
  'the file_kind CHECK accepts exactly the four brief kinds (pinned)');

-- Cascade: deleting a document takes its revisions and their files with it,
-- and the ON DELETE SET NULL (current_revision_id) does not deadlock against it.
create temp table t_counts as
select (select count(*) from dcs.revisions) as revs, (select count(*) from dcs.files) as files;
select lives_ok(
  $$delete from dcs.documents where id = (select doc1_id from t_fixture)$$,
  'GREEN: a document with a current_revision_id can be deleted (ON DELETE SET NULL is column-scoped)');
select is((select count(*) from dcs.revisions where document_id = (select doc1_id from t_fixture)), 0::bigint,
  'deleting the document cascaded to its revisions');
select is((select count(*) from dcs.files), 0::bigint,
  'and through them to its files');
select is(
  (select count(*) from public.audit_log
    where table_name in ('dcs.documents', 'dcs.revisions', 'dcs.files')
      and action = 'DELETE'
      and project_id = (select pej_id from t_fixture)),
  4::bigint,
  'the cascade is fully audited, every entry carrying the project (so the DC can read it) — 1 document + 2 revisions + 1 file');

-- Rebuild the fixture row the RLS section works on.
insert into dcs.documents (
  id, project_id, scl_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id, ctr_code)
select doc1_id, pej_id, 'SC2602-SCL-RA-0001-EN', 'Fixture document',
       doc_type_id, discipline_id, area_id, language_id, status_id, ctr_pej_id
  from t_fixture;
insert into dcs.revisions (id, document_id, project_id, scl_revision, step_id, status_id)
select rev1_id, doc1_id, pej_id, 'A', step_id, status_id from t_fixture;
insert into dcs.files (revision_id, project_id, file_kind, original_name)
select rev1_id, pej_id, 'original', 'fixture.pdf' from t_fixture;

-- The bare row counts the RLS section compares against, read once as postgres
-- (which is RLS-exempt) rather than hard-coded.
create temp table t_all_rows as
select (select count(*) from dcs.documents where project_id = (select pej_id from t_fixture)) as docs,
       (select count(*) from dcs.revisions where project_id = (select pej_id from t_fixture)) as revs,
       (select count(*) from dcs.files where project_id = (select pej_id from t_fixture)) as files,
       (select count(*) from dcs.documents) as docs_everywhere;
grant select on t_all_rows to authenticated;

-- Without this the member assertions below would be satisfied by a table that
-- happens to hold only this project's rows, proving nothing.
select cmp_ok((select docs_everywhere from t_all_rows), '>', (select docs from t_all_rows),
  'sanity: documents of a second project (IT) exist, so "a member sees the project''s documents" is a real filter and not an empty one');

-- ============================================================
-- 5. RLS — SELECT
-- ============================================================
set local role authenticated;

-- Outsider: no project_assignments row, no project_roles row, anywhere.
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*) from dcs.documents), 0::bigint,
  'RED: a non-member sees no documents at all (bare count, no WHERE)');
select is((select count(*) from dcs.revisions), 0::bigint,
  'RED: a non-member sees no revisions');
select is((select count(*) from dcs.files), 0::bigint,
  'RED: a non-member sees no files');

-- Ernest: TES member of PEJ via project_assignments, no DCS role at all.
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select is((select count(*) from dcs.documents), (select docs from t_all_rows),
  'GREEN: a plain TES member of the project reads every document — is_project_member covers project_assignments, not only DCS roles');
select is((select count(*) from dcs.revisions), (select revs from t_all_rows),
  'GREEN: the same member reads every revision');
select is((select count(*) from dcs.files), (select files from t_all_rows),
  'GREEN: the same member reads every file');

-- Viewer: DCS role `view` on PEJ.
select set_config('request.jwt.claims',
  json_build_object('sub', (select viewer_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*) from dcs.documents), (select docs from t_all_rows),
  'GREEN: a VIEW member reads every document');

-- ============================================================
-- 6. RLS — INSERT
-- ============================================================

-- VIEW may read and nothing else, even at aal2.
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'VIEW-1', 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  '42501', null,
  'RED: a VIEW member cannot insert a document (42501) even at aal2');
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id)
    select doc1_id, pej_id, 'V', step_id, status_id from t_fixture$$,
  '42501', null,
  'RED: a VIEW member cannot insert a revision (42501)');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_kind) select rev1_id, pej_id, 'original' from t_fixture$$,
  '42501', null,
  'RED: a VIEW member cannot insert a file (42501)');

-- Outsider, at aal2, still nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'OUT-1', 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  '42501', null,
  'RED: a non-member cannot insert a document (42501)');

-- ORIG inserts, and does NOT need a second factor to do it.
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select lives_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'ORIG-1', 'Originator document', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  'GREEN: an ORIG inserts a document at aal1 — the second factor is asked of the DC, not of the Originator');
select lives_ok(
  $$insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id)
    select doc1_id, pej_id, 'O', step_id, status_id from t_fixture$$,
  'GREEN: an ORIG inserts a revision at aal1');
select lives_ok(
  $$insert into dcs.files (revision_id, project_id, file_kind) select rev1_id, pej_id, 'attachment' from t_fixture$$,
  'GREEN: an ORIG inserts a file at aal1');

-- DC inserts only at aal2.
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'DC-AAL1', 't', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  '42501', null,
  'RED: a DC at aal1 cannot insert a document (42501) — 1a.11''s rule, applied to the register');
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'DC-AAL2', 'DC document', doc_type_id, discipline_id, area_id, language_id, status_id from t_fixture$$,
  'GREEN: the same DC inserts at aal2');

-- ============================================================
-- 7. The numbering columns — two layers, asserted separately
-- ============================================================

-- Layer 1 (RLS): a dc-only caller at aal1 does not pass the UPDATE policy at
-- all, so the statement matches zero rows rather than raising.
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);
update dcs.documents set cpy_doc_number = 'HACK-AAL1' where id = (select doc1_id from t_fixture);
select is(
  (select count(*) from dcs.documents where cpy_doc_number = 'HACK-AAL1'),
  0::bigint,
  'RED: a DC at aal1 updating cpy_doc_number affects zero rows — stopped by RLS before the trigger is reached');

-- Layer 2 (trigger): a caller who DOES pass the UPDATE policy at aal1 —
-- someone holding orig as well as dc — is still refused the numbering change.
-- This is the case RLS structurally cannot catch.
select set_config('request.jwt.claims',
  json_build_object('sub', (select both_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select lives_ok(
  $$update dcs.documents set title = 'Retitled by orig+dc at aal1' where id = (select doc1_id from t_fixture)$$,
  'GREEN: orig+dc at aal1 may edit an ordinary column — they pass the Originator UPDATE policy');
select throws_ok(
  $$update dcs.documents set cpy_doc_number = 'HACK-BOTH-AAL1' where id = (select doc1_id from t_fixture)$$,
  '42501', null,
  'RED: the same caller, same statement shape, is refused the cpy_doc_number change at aal1 (42501) — the trigger, not RLS');
select throws_ok(
  $$update dcs.revisions set scl_revision = 'ZZ' where id = (select rev1_id from t_fixture)$$,
  '42501', null,
  'RED: scl_revision is a numbering column too — refused at aal1 (42501)');

-- Same caller at aal2: allowed.
select set_config('request.jwt.claims',
  json_build_object('sub', (select both_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$update dcs.documents set cpy_doc_number = 'CLIENT-042' where id = (select doc1_id from t_fixture)$$,
  'GREEN: the DC changes cpy_doc_number at aal2');

-- A plain ORIG — a project member who may update the row — cannot move a
-- number at any assurance level.
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$update dcs.documents set title = 'Retitled by orig' where id = (select doc1_id from t_fixture)$$,
  'GREEN: an ORIG edits an ordinary column of a document');
select throws_ok(
  $$update dcs.documents set cpy_doc_number = 'ORIG-TRIED' where id = (select doc1_id from t_fixture)$$,
  '42501', null,
  'RED: a non-DC project member cannot change cpy_doc_number (42501) even at aal2 — the role check, not the aal check');
select throws_ok(
  $$update dcs.documents set scl_doc_number = 'ORIG-TRIED' where id = (select doc1_id from t_fixture)$$,
  '23001', null,
  'RED: and scl_doc_number is refused before the role is even considered (23001, immutable for everyone)');
select is(
  (select cpy_doc_number from dcs.documents where id = (select doc1_id from t_fixture)),
  'CLIENT-042',
  'after all of the above the number is still the one the DC set at aal2');

reset role;

-- ============================================================
-- 8. The audit trail of the whole section above
-- ============================================================
select ok(
  (select count(*) from public.audit_log
    where table_name in ('dcs.documents', 'dcs.revisions', 'dcs.files')
      and project_id is null) = 0,
  'every audit_log entry for the three tables carries a project_id — none falls outside the DC''s "own projects" policy');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and field_name = 'updated_at'),
  0::bigint,
  'updated_at never appears as a changed field (audit_trigger filters it, set_updated_at notwithstanding)');
select results_eq(
  $$select new_value #>> '{}', user_id is null from public.audit_log
     where table_name = 'dcs.documents' and field_name = 'cpy_doc_number'
       and record_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
     order by new_value$$,
  $$values ('CLIENT-001', true), ('CLIENT-042', false)$$,
  'exactly two cpy_doc_number changes are logged for the fixture document: the sessionless one from section 4 (user_id NULL, as audit_trigger records seed/migration writes) and the DC''s at aal2 — every refused attempt left no trace at all');
select is(
  (select user_id from public.audit_log
    where table_name = 'dcs.documents' and field_name = 'cpy_doc_number'
      and record_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
      and new_value #>> '{}' = 'CLIENT-042'),
  (select both_id from t_fixture),
  'and the one made through the app is attributed to the session that made it');

select * from finish();
rollback;
