-- Tests for DCS 1b.04: no documents on a project DCS does not run.
-- Migration 20260918134211_documents_require_mdr_settings.
--
-- The rule 1b.01 named and 1b.02 declined, open in docs/deferred-tasks.md (oo)
-- until now: a missing dcs.mdr_settings row means "DCS does not run this
-- project" (1a.05), and a project DCS does not run may carry no documents.
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-… has an mdr_settings row;
-- IT = 094e130b-… (project_code SCMS-IT) has none, which is what makes it the
-- subject of this file. Fixtures as postgres inside this rolled-back
-- transaction, following scl_doc_number_generator.test.sql.
--
-- The three assertions this file exists for, and which no other file makes:
-- the refusal itself, the absence of ANY bypass (section 4), and the proof
-- that a refused creation writes nothing at all (section 5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select has_function('public', 'enforce_document_needs_mdr', 'public.enforce_document_needs_mdr() exists');

select has_trigger('dcs', 'documents', 'documents_mdr_required',
  'trigger documents_mdr_required is attached to dcs.documents');

-- INSERT only. Guarding UPDATE would strand every document on a project whose
-- settings row an admin later deleted — Void included, which is the brief's
-- answer to a document that should not exist.
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and tgname = 'documents_mdr_required'),
  'CREATE TRIGGER documents_mdr_required BEFORE INSERT ON dcs.documents FOR EACH ROW EXECUTE FUNCTION enforce_document_needs_mdr()',
  'it is BEFORE INSERT and nothing else — an existing document stays editable even if its project loses its settings row');

-- Firing order is name order among BEFORE triggers, and this one must sort
-- AFTER documents_cpy_numbering so that an insert carrying a CPY number on a
-- settings-less project keeps getting the CPY guard's more specific answer —
-- which rls_document_register.test.sql and dc_only_numbering_on_insert.test.sql
-- both already assert.
select ok(
  'documents_mdr_required' > 'documents_cpy_numbering',
  'documents_mdr_required sorts after documents_cpy_numbering, so the CPY guard still answers first for a CPY-carrying insert');

-- ============================================================
-- 2. Fixtures
-- ============================================================
create temp table t as
select
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,  -- has mdr_settings (seed)
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,   -- has none
  (select id from dcs.dictionaries where dict_type = 'doc_type'        and code = 'RA')          as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline'      and code = 'A00')         as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area'            and code = '00')          as area_id,
  (select id from dcs.dictionaries where dict_type = 'language'        and code = 'EN')          as en_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as st_id;

create function pg_temp.add_doc(p_project uuid, p_title text)
  returns text language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id,
                             language_id, workflow_status_id)
  select p_project, p_title, ra_id, disc_id, area_id, en_id, st_id from t
  returning scl_doc_number;
$$;

-- Sanity: the two projects really are in the two states this file assumes.
select is(
  (select count(*) from dcs.mdr_settings where project_id = (select it_id from t)),
  0::bigint,
  'sanity: SCMS-IT has no mdr_settings row — the state this rule is about');
select is(
  (select count(*) from dcs.mdr_settings where project_id = (select pej_id from t)),
  1::bigint,
  'sanity: SC2602 has one');

-- ============================================================
-- 3. The rule
-- ============================================================
select lives_ok(
  $$select pg_temp.add_doc((select pej_id from t), 'On a project DCS runs')$$,
  'GREEN: a document is created on a project that has an mdr_settings row');

select throws_ok(
  $$select pg_temp.add_doc((select it_id from t), 'On a project DCS does not run')$$,
  '23514',
  'dcs.documents cannot be created on project 094e130b-599b-4295-87fa-697fb71e7fc4: it has no dcs.mdr_settings row, which means DCS does not run this project. Its Document Controller must configure the project MDR first.',
  'RED: a document on a project with no mdr_settings row is refused (23514), and the message names the missing MDR configuration');

-- Same SQLSTATE as enforce_cpy_numbering_enabled(), so the MESSAGE is the only
-- thing separating the two guards. Asserted rather than assumed: if a later
-- change made this trigger fire first, the CPY tests elsewhere would start
-- reading this message instead, and this assertion is what would say why.
-- scl_doc_number is left NULL here. Supplying one sends the insert into
-- documents_assign_scl_number instead — the FIRST BEFORE trigger by name — and
-- the assertion then reads 1b.02's restrict_violation rather than either of the
-- two guards this is about. (That is what the first run of this file did.)
select throws_like(
  $$insert into dcs.documents (project_id, cpy_doc_number, title, doc_type_id,
                               discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'CLIENT-001', 't', ra_id, disc_id, area_id, en_id, st_id from t$$,
  '%CPY track is the client%',
  'a CPY-carrying insert on the same project still gets the CPY guard''s message, not this one — the two are told apart by message, not SQLSTATE');

-- ============================================================
-- 4. No bypass. This is the decision the migration is built on, so it is the
--    section worth reading.
--
-- enforce_dc_only_numbering() exempts a sessionless caller because it is an
-- AUTHORIZATION rule — it decides which of several signed-in users may act.
-- This one is a FACT about the project's configuration, so there is no reading
-- under which the answer depends on who is asking.
-- ============================================================

-- Everything in this file runs as postgres: RLS-exempt, owner of the table,
-- the caller every other bypass in this schema exists for. Still refused.
select is(
  (select current_user), 'postgres',
  'the refusal above happened to postgres — RLS-exempt, table owner, the caller enforce_dc_only_numbering() lets through');

-- 1b.02's import escape hatch opens scl_doc_number, and ONLY scl_doc_number.
-- It deliberately does not open this gate: the SMDR import must create a
-- project's MDR before its register, and this assertion is where that lands if
-- anyone later assumes otherwise.
set local dcs.import_mode = 'on';
select throws_ok(
  $$select pg_temp.add_doc((select it_id from t), 'Import mode does not help')$$,
  '23514',
  'dcs.documents cannot be created on project 094e130b-599b-4295-87fa-697fb71e7fc4: it has no dcs.mdr_settings row, which means DCS does not run this project. Its Document Controller must configure the project MDR first.',
  'RED: dcs.import_mode = ''on'' does NOT open this gate — the SMDR import must create the MDR before the register (1b.12-1b.15)');
set local dcs.import_mode = '';

-- ============================================================
-- 5. A refused creation writes nothing — the acceptance criterion
-- ============================================================
select is(
  (select count(*) from dcs.documents where project_id = (select it_id from t)),
  0::bigint,
  'after four refused inserts, dcs.documents holds no row for that project at all');

-- A BEFORE trigger raises before any AFTER trigger runs, so the refusal leaves
-- no audit entry either — the same property 1b.01 asserts for its own guards.
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and project_id = (select it_id from t)),
  0::bigint,
  'and no audit_log entry: a BEFORE trigger refuses before audit_trigger() ever runs');

-- ============================================================
-- 6. The gate opens the moment the project is enrolled, and nothing else
--    about the project changed
-- ============================================================
insert into dcs.mdr_settings (project_id) select it_id from t;

select is(
  (select pg_temp.add_doc((select it_id from t), 'Now DCS runs it')),
  'SCMS-IT-SCL-RA-0001-EN',
  'GREEN: with an mdr_settings row the very same insert succeeds — and still gets its number from the 1b.02 generator, SEQ starting at 0001');

select * from finish();
rollback;
