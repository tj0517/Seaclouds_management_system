-- Tests for DCS 1b.05: dcs.v_mdr — the MDR register view.
-- Migration 20260919123436_create_mdr_register_view.
--
-- Pattern follows rls_document_register.test.sql (1b.01): fixtures as postgres
-- inside this transaction (rolled back at the end), then impersonation via
-- `set local role authenticated` + request.jwt.claims carrying an explicit
-- aal, exactly like PostgREST. Every "this user sees / does not see"
-- assertion is a bare count(*) with no WHERE (docs/03-conventions.md): the
-- difference between users has to be made by the database, not the query.
--
-- Three things this file is built around, each worth reading before the
-- assertions:
--
--   * THE PLAN ASSERTIONS RUN WITH enable_seqscan = off, and that is not a
--     trick to make a test pass. Measured on the local stack 2026-09-19: the
--     planner picks documents_search_idx by itself only at around 20 000 rows.
--     At the 200 rows this file seeds — and at 2 000 — it correctly prefers a
--     sequential scan, because reading a small table end to end is genuinely
--     cheaper. So what is provable at this size is that the index CAN serve
--     the register's search predicate, not that the planner would choose it
--     today. enable_seqscan = off asks exactly that question. The red proof
--     below (same setting, index dropped) is what gives the green one its
--     meaning: with the index gone there is no alternative but the seq scan.
--
--   * The 200 documents are seeded INSIDE this transaction and rolled back
--     with it. The register is empty on purpose (prod 0 rows, scl-dev 1) and
--     the 146-document import is 1b.13 — no test may leave demo rows behind.
--
--   * Like the 1b.01 file, this one opens 1b.02's import escape hatch and
--     supplies scl_doc_number by hand. Here the reason is the subject: the
--     search assertions have to know which numbers exist, and 200 calls to
--     dcs.next_doc_number would each take an advisory lock and re-scan the
--     table to test numbering, which is not what this file is about. See
--     docs/deferred-tasks.md (qq) for what that hatch does and does not cost.
--
-- Cast:
--   member    mdr-member@example.com    DCS role `view` on PEJ — reads, nothing else
--   outsider  mdr-outsider@example.com  no role, no assignment, anywhere
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-…, IT = 094e130b-… (which has no
-- mdr_settings row in the seed and is enrolled below, because from 1b.04 on a
-- project DCS does not run can carry no documents at all).
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

set local dcs.import_mode = 'on';

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select has_view('dcs', 'v_mdr', 'view dcs.v_mdr exists');

-- THE assertion the whole RLS story rests on. Without security_invoker a view
-- is read with its OWNER's permissions, and dcs.v_mdr would hand every
-- authenticated user every project's register. Asserted here as a catalog
-- fact and again in section 6 as a behavioural one, because the two can drift:
-- a view recreated without the option would still pass a behavioural test run
-- as a member.
select ok(
  (select c.reloptions @> array['security_invoker=true']
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dcs' and c.relname = 'v_mdr'),
  'dcs.v_mdr is security_invoker = true — the caller''s RLS on dcs.documents decides the rows, the view widens nothing');

-- Every annex-C column group, by name. This is the assertion that fails when
-- someone "tidies up" a NULL column out of the view: the layout is a
-- requirement (annex C), not an implementation detail.
select columns_are('dcs', 'v_mdr',
  array[
    -- identity and scope
    'document_id', 'project_id', 'project_code', 'project_name',
    -- DOCUMENT INFO
    'process', 'orig_code', 'doc_type_code', 'seq', 'scl_doc_number',
    'cpy_doc_number', 'title', 'doc_type_description', 'discipline_code',
    'discipline_label', 'ctr_code', 'ctr_description', 'budget_hours',
    -- STATUS
    'cpy_revision', 'scl_revision', 'issue_date',
    'workflow_status_code', 'workflow_status_label',
    -- WORKFLOW
    'workflow_type', 'originator_id', 'checker_id', 'approver_id',
    -- the four stage groups
    'idc_planned', 'idc_forecast', 'idc_actual', 'idc_revision',
    'ifr_planned', 'ifr_forecast', 'ifr_actual', 'ifr_revision',
    'retcom_planned', 'retcom_forecast', 'retcom_actual', 'retcom_revision',
    'ifc_ifi_planned', 'ifc_ifi_forecast', 'ifc_ifi_actual', 'ifc_ifi_revision',
    -- filter keys
    'doc_type_id', 'discipline_id', 'area_id', 'language_id',
    'workflow_status_id', 'area_code', 'area_label', 'language_code',
    'search_text',
    'created_at', 'updated_at'],
  'v_mdr exposes every annex-C column group plus the filter keys');

-- The sixteen stage columns are typed NULLs, not missing and not text. Phase 2
-- swaps the view's source; if these came back as text the generated TypeScript
-- row type would change under the screen at that moment.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'dcs' and table_name = 'v_mdr'
      and column_name ~ '_(planned|forecast|actual)$'
      and data_type = 'date'),
  12::bigint,
  'the twelve stage DATE columns (4 stages x Planned/Forecast/Actual) are typed date');
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'dcs' and table_name = 'v_mdr'
      and column_name ~ '^(idc|ifr|retcom|ifc_ifi)_revision$'
      and data_type = 'text'),
  4::bigint,
  'the four stage-revision columns are typed text');
select col_type_is('dcs', 'v_mdr', 'workflow_type', 'text',
  'workflow_type is typed text — annex C WORKFLOW > Type, source unknown, deliberately not guessed');
select col_type_is('dcs', 'v_mdr', 'process', 'text',
  'process is text, not the public.project_process_type enum — a new enum label must not change this column''s type');

-- ============================================================
-- 2. Grants — the view may be read and only read
-- ============================================================
select ok(has_table_privilege('authenticated', 'dcs.v_mdr', 'select'),
  'authenticated may SELECT dcs.v_mdr');
select ok(
  not has_table_privilege('authenticated', 'dcs.v_mdr', 'insert')
  and not has_table_privilege('authenticated', 'dcs.v_mdr', 'update')
  and not has_table_privilege('authenticated', 'dcs.v_mdr', 'delete'),
  'authenticated may NOT write through dcs.v_mdr — the dcs default privileges grant ALL, and the migration narrows it back to SELECT');
select ok(not has_table_privilege('anon', 'dcs.v_mdr', 'select'),
  'anon may not read the register at all');

-- ============================================================
-- 3. The indexes this task adds
-- ============================================================
select has_index('dcs', 'documents', 'documents_search_idx',
  'documents_search_idx exists — the combined search');
-- No index is added for the default sort, on purpose and with a measurement
-- behind it (see the migration header). These two assertions pin the two
-- pre-existing 1b.01 indexes the register's default ordering and project
-- filter actually rely on, so that deleting either one fails HERE rather than
-- quietly making the main screen slow.
select has_index('dcs', 'documents', 'documents_scl_doc_number_key',
  'documents_scl_doc_number_key (1b.01) still exists — it is what orders the register by default');
select has_index('dcs', 'documents', 'documents_project_id_idx',
  'documents_project_id_idx (1b.01) still exists — it is what serves the project filter');
select ok(
  (select indexdef like '%gin%' and indexdef like '%gin_trgm_ops%'
     from pg_indexes where schemaname = 'dcs' and indexname = 'documents_search_idx'),
  'documents_search_idx is a GIN trigram index — an infix match cannot use a btree at all');
select ok(
  (select count(*) = 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'extensions'),
  'pg_trgm is installed in `extensions`, not in public — public is the schema PostgREST exposes');

-- ============================================================
-- 4. Fixtures — 200 synthetic documents, inside this transaction
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
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'mdr-member@example.com', 'Register member'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid, 'mdr-outsider@example.com', 'Register outsider')
) as u(id, email, name);

create temp table t_fixture as
select
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid as member_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid as outsider_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as doc_type_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as discipline_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as language_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as status_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC') as step_id;
grant select on t_fixture to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select pej_id, member_id, 'view'::dcs.project_role from t_fixture;

-- CPY numbers are part of the search, so the project has to run a CPY track.
-- A sessionless caller (postgres) is exempt from the DC check — 1b.03.
update dcs.mdr_settings set cpy_numbering = true
 where project_id = (select pej_id from t_fixture);

-- IT is enrolled so it can carry documents at all (1b.04's documents_mdr_required).
-- It needs to: the RLS section compares "every document" against "PEJ's
-- documents", and without a second project that comparison is vacuous.
insert into dcs.mdr_settings (project_id) select it_id from t_fixture;

-- 200 on PEJ. Every third carries a CPY number, so the CPY search has both
-- matching and NULL rows to distinguish — a coalesce() bug in the view's
-- search_text would otherwise pass unnoticed.
insert into dcs.documents (
  project_id, scl_doc_number, cpy_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select
  f.pej_id,
  'SC2602-SCL-RA-' || lpad(g::text, 4, '0') || '-EN',
  case when g % 3 = 0 then 'CLIENT-DOC-' || g else null end,
  'Synthetic register row ' || g,
  f.doc_type_id, f.discipline_id, f.area_id, f.language_id, f.status_id
from t_fixture f, generate_series(1, 200) g;

-- One on IT, carrying the hyphenated project code that breaks a left-to-right
-- parser. SCMS-IT is a live project code on scl-dev (O-11), so
-- SCMS-IT-SCL-RA-0001-EN has SIX fields, not five.
insert into dcs.documents (
  project_id, scl_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select f.it_id, 'SCMS-IT-SCL-RA-0001-EN', 'Hyphenated project code',
       f.doc_type_id, f.discipline_id, f.area_id, f.language_id, f.status_id
from t_fixture f;

analyze dcs.documents;

-- ============================================================
-- 5. The view's content
-- ============================================================
select is((select count(*) from dcs.v_mdr), 201::bigint,
  'the view returns one row per document — no join fans a document out, and no LEFT JOIN drops one');

-- ORIG and SEQ are parsed from the RIGHT. A left-to-right parser returns 'IT'
-- and 'SCL' for the row below; this is the assertion that catches it.
select is(
  (select orig_code from dcs.v_mdr where scl_doc_number = 'SCMS-IT-SCL-RA-0001-EN'),
  'SCL',
  'orig_code is parsed from the right — a project_code containing a hyphen (SCMS-IT) does not shift the field');
select is(
  (select seq from dcs.v_mdr where scl_doc_number = 'SCMS-IT-SCL-RA-0001-EN'),
  '0001',
  'seq is parsed from the right for the same number');
select is(
  (select seq from dcs.v_mdr where scl_doc_number = 'SC2602-SCL-RA-0042-EN'),
  '0042',
  'seq of an ordinary five-field number');
select is(
  (select process from dcs.v_mdr where scl_doc_number = 'SCMS-IT-SCL-RA-0001-EN'),
  (select process_type::text from public.projects where id = (select it_id from t_fixture)),
  'process comes from the document''s PROJECT (public.projects.process_type), not from the document');

-- Every stage column NULL on every row, which is the whole of decision 1.
select ok(
  (select bool_and(
      idc_planned is null and idc_forecast is null and idc_actual is null and idc_revision is null and
      ifr_planned is null and ifr_forecast is null and ifr_actual is null and ifr_revision is null and
      retcom_planned is null and retcom_forecast is null and retcom_actual is null and retcom_revision is null and
      ifc_ifi_planned is null and ifc_ifi_forecast is null and ifc_ifi_actual is null and ifc_ifi_revision is null)
     from dcs.v_mdr),
  'all sixteen stage columns are NULL on every row — there is no dcs.plan_dates table to fill them (Phase 2)');
select ok((select bool_and(workflow_type is null) from dcs.v_mdr),
  'workflow_type is NULL on every row — annex C WORKFLOW > Type has no source and was not guessed');

-- A document with no current revision still has a STATUS group; it is empty.
-- All 201 are in that state, which is what the register looks like today.
select ok(
  (select bool_and(scl_revision is null and cpy_revision is null and issue_date is null)
     from dcs.v_mdr),
  'the STATUS revision columns are empty while no document has a current revision — the LEFT JOIN keeps the row');
select is(
  (select count(distinct workflow_status_code) from dcs.v_mdr),
  1::bigint,
  'every document still carries its document-level workflow status (NOT_STARTED) even with no revision');

-- Now give one document a current revision and watch the STATUS group fill.
-- This is the half a NULL-only fixture could never prove: that the join to
-- dcs.revisions is wired to current_revision_id and actually resolves.
with d as (select id, project_id from dcs.documents where scl_doc_number = 'SC2602-SCL-RA-0007-EN'),
     r as (
       insert into dcs.revisions (document_id, project_id, scl_revision, cpy_revision, step_id, status_id, revision_date)
       select d.id, d.project_id, 'A', 'C01', f.step_id, f.status_id, date '2026-09-19'
         from d, t_fixture f
       returning id, document_id
     )
update dcs.documents set current_revision_id = r.id from r where dcs.documents.id = r.document_id;

select is(
  (select scl_revision from dcs.v_mdr where scl_doc_number = 'SC2602-SCL-RA-0007-EN'),
  'A', 'STATUS > SCL Revision resolves through current_revision_id');
select is(
  (select cpy_revision from dcs.v_mdr where scl_doc_number = 'SC2602-SCL-RA-0007-EN'),
  'C01', 'STATUS > CPY Revision comes from the same revision');
select is(
  (select issue_date from dcs.v_mdr where scl_doc_number = 'SC2602-SCL-RA-0007-EN'),
  date '2026-09-19', 'STATUS > Issue Date is the revision''s revision_date');
select is((select count(*) from dcs.v_mdr), 201::bigint,
  'and adding a revision did not duplicate the document''s row');

-- ============================================================
-- 6. The combined search — one query, three kinds of match
-- ============================================================
--
-- ONE query, three counts. Not three queries: the acceptance criterion is that
-- a single search field finds a document by any of the three, and a file that
-- asked each question separately would pass even if the view exposed three
-- unrelated search fields.
select results_eq(
  $$select count(*) filter (where search_text ilike '%RA-0042%'),
           count(*) filter (where search_text ilike '%CLIENT-DOC-9%'),
           count(*) filter (where search_text ilike '%register row 7%')
      from dcs.v_mdr$$,
  $$values (1::bigint, 5::bigint, 11::bigint)$$,
  'one query finds rows by SCL number, by CPY number and by a title fragment');

select is(
  (select document_id from dcs.v_mdr where search_text ilike '%CLIENT-DOC-42%'),
  (select id from dcs.documents where cpy_doc_number = 'CLIENT-DOC-42'),
  'the CPY match returns the right document');
select is(
  (select count(*) from dcs.v_mdr where search_text ilike '%ynthetic regis%'),
  201::bigint - 1,
  'a fragment starting mid-word matches — this is an infix search, not a word-prefix one (the IT document''s title does not contain it)');
select is(
  (select count(*) from dcs.v_mdr where search_text ilike '%CLIENT-DOC%'),
  66::bigint,
  'documents with a NULL cpy_doc_number are not matched by a CPY fragment — coalesce() does not turn NULL into a match');

-- ============================================================
-- 7. The plan — the index is what serves the search
--
-- Read the header note before changing anything here: enable_seqscan = off is
-- deliberate and the red proof immediately after is what makes the green one
-- mean something.
-- ============================================================
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare line text; out text := '';
begin
  for line in execute 'explain (costs off) ' || q loop out := out || line || E'\n'; end loop;
  return out;
end $$;

set local enable_seqscan = off;

select ok(
  pg_temp.plan_of($$select document_id, title from dcs.v_mdr where search_text ilike '%row 42%'$$)
    like '%documents_search_idx%',
  'the register''s search predicate is served by documents_search_idx — the filter is pushed through the view to the base table');
select ok(
  pg_temp.plan_of($$select document_id, title from dcs.v_mdr where search_text ilike '%row 42%'$$)
    not like '%Seq Scan%',
  'and no sequential scan remains in that plan');

-- RED PROOF. Same query, same setting, index gone. If this ever passes with
-- the index present, the green assertions above are measuring nothing.
savepoint before_drop;
drop index dcs.documents_search_idx;
select ok(
  pg_temp.plan_of($$select document_id, title from dcs.v_mdr where search_text ilike '%row 42%'$$)
    like '%Seq Scan%',
  'RED: with documents_search_idx dropped the very same search falls back to a sequential scan');
select ok(
  pg_temp.plan_of($$select document_id, title from dcs.v_mdr where search_text ilike '%row 42%'$$)
    not like '%documents_search_idx%',
  'RED: and the index is genuinely absent from the plan, not merely one option among several');
rollback to savepoint before_drop;

select has_index('dcs', 'documents', 'documents_search_idx',
  'the index is back after the red proof — the rest of the file is not running against a degraded schema');

-- The default sort reaches an index rather than sorting the whole table. Which
-- index is deliberately NOT pinned: measured 2026-09-19, the planner picks
-- documents_scl_doc_number_key here and documents_project_id_idx when the
-- project filter is selective, and both are correct answers. Asserting one of
-- them by name would be asserting a cost estimate, which changes with the data.
select ok(
  pg_temp.plan_of($$select scl_doc_number from dcs.v_mdr
                     where project_id = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'
                     order by scl_doc_number$$)
    like '%Index%',
  'the default ordering within one project reaches an index, not a full sort of the register');

reset enable_seqscan;

-- ============================================================
-- 8. RLS through the view
--
-- The point of the whole migration: dcs.v_mdr adds no access of its own. Every
-- assertion is a bare count with no WHERE — docs/03-conventions.md, a proof
-- with a filter in it proves nothing.
-- ============================================================

-- Read as postgres (RLS-exempt) rather than hard-coded, so these stay true if
-- the fixture counts above change.
create temp table t_all_rows as
select (select count(*) from dcs.v_mdr) as everywhere,
       (select count(*) from dcs.v_mdr where project_id = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc') as pej;
grant select on t_all_rows to authenticated;

select cmp_ok((select everywhere from t_all_rows), '>', (select pej from t_all_rows),
  'sanity: a second project''s documents exist in the view, so "a member sees their project''s rows" is a real filter and not an empty one');

set local role authenticated;

-- The failing case the acceptance criterion asks for, proved rather than
-- reasoned about: no role on the project, at aal2, sees nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*) from dcs.v_mdr), 0::bigint,
  'RED: a user with no role on any project sees ZERO rows through dcs.v_mdr (bare count, no WHERE)');
select is((select count(*) from dcs.v_mdr where project_id = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'), 0::bigint,
  'RED: and none of PEJ''s rows in particular');
select is((select count(*) from dcs.v_mdr where search_text ilike '%register row%'), 0::bigint,
  'RED: the search does not leak them either — a filter cannot widen what RLS returned');

-- The member sees exactly their project, and not the other project's row.
select set_config('request.jwt.claims',
  json_build_object('sub', (select member_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select is((select count(*) from dcs.v_mdr), (select pej from t_all_rows),
  'GREEN: a VIEW member of PEJ sees exactly PEJ''s rows — every one of them, and only them');
select is((select count(*) from dcs.v_mdr where scl_doc_number = 'SCMS-IT-SCL-RA-0001-EN'), 0::bigint,
  'GREEN: and not the document of the project they hold no role on');
select is((select count(*) from dcs.v_mdr where search_text ilike '%RA-0042%'), 1::bigint,
  'GREEN: the same member''s search still works inside their own project');

-- A read-only member may not write through the view, and the view is not
-- auto-updatable anyway (it has joins). Both layers asserted, because a later
-- simplification of the view could remove the second one silently.
select throws_ok(
  $$update dcs.v_mdr set title = 'hacked' where scl_doc_number = 'SC2602-SCL-RA-0001-EN'$$,
  null, null,
  'RED: nobody writes through dcs.v_mdr — it is SELECT-only by grant and not auto-updatable by shape');

reset role;

-- ============================================================
-- 9. What this file does NOT cover
-- ============================================================
-- * The DC half of the register's RLS (deferred-tasks qq) is still not covered
--   anywhere — this file adds a VIEW member and an outsider, not a DC.
-- * The planner's real-world choice of documents_search_idx at production row
--   counts. See the header: at 200 rows it is provable that the index serves
--   the predicate, not that it would be chosen.
-- * The 1b.02 generator, for the same reason 1b.01's file does not cover it:
--   the import hatch is open for this whole transaction.
select * from finish();
rollback;
