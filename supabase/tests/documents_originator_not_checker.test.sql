-- Tests for DCS 1b.04: the Originator may not also be the Checker.
-- Migration 20260918134210_documents_originator_not_checker.
--
-- Pattern follows scl_doc_number_generator.test.sql: fixtures as postgres
-- inside this transaction (rolled back at the end). There is no RLS section
-- here on purpose — a CHECK constraint is not a policy, it does not depend on
-- who is asking, and the point of section 4 below is precisely that it holds
-- for the caller who bypasses every policy there is.
--
-- Every INSERT leaves scl_doc_number NULL and lets 1b.02's generator fill it,
-- which is the path the 1b.04 form actually takes. No dcs.import_mode here.
--
-- PEJ = 6c0909ce-… carries an mdr_settings row from supabase/seed.sql, which
-- since 1b.04 is what makes any of these documents creatable at all
-- (documents_mdr_required — its own file is
-- supabase/tests/documents_require_mdr_settings.test.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ============================================================
-- 1. The constraint exists and says what it is meant to say (red without
--    the migration)
-- ============================================================
select has_check('dcs', 'documents', 'dcs.documents has CHECK constraints');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'dcs.documents'::regclass
      and conname = 'documents_originator_not_checker'),
  'CHECK (((originator_id IS NULL) OR (checker_id IS NULL) OR (originator_id <> checker_id)))',
  'documents_originator_not_checker is a CHECK with both NULL escapes spelled out — NOT `is distinct from`, which would reject an unstaffed document');

-- ============================================================
-- 2. Fixtures
-- ============================================================
create temp table t as
select
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as user_a,
  (select id from auth.users where email = 'ejezionek@gmail.com')      as user_b,
  (select id from auth.users where email = 'tjezionekspam@gmail.com')  as user_c,
  (select id from dcs.dictionaries where dict_type = 'doc_type'        and code = 'RA')          as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline'      and code = 'A00')         as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area'            and code = '00')          as area_id,
  (select id from dcs.dictionaries where dict_type = 'language'        and code = 'EN')          as en_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as st_id;

-- Staffing is the only thing that varies; everything else is constant, so the
-- assertions below read as what they are about.
create function pg_temp.add_doc(p_title text, p_orig uuid, p_chk uuid, p_app uuid default null)
  returns text language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id,
                             language_id, workflow_status_id,
                             originator_id, checker_id, approver_id)
  select pej_id, p_title, ra_id, disc_id, area_id, en_id, st_id, p_orig, p_chk, p_app from t
  returning scl_doc_number;
$$;

-- ============================================================
-- 3. The rule itself
-- ============================================================
select lives_ok(
  $$select pg_temp.add_doc('Two different people', (select user_a from t), (select user_b from t))$$,
  'GREEN: Originator and Checker are two different people');

select throws_ok(
  $$select pg_temp.add_doc('Same person twice', (select user_a from t), (select user_a from t))$$,
  '23514',
  null,
  'RED: Originator = Checker is rejected by the database (23514), with no form involved');

-- The message names the constraint, so a caller can tell this refusal from the
-- table's other CHECK (documents_budget_hours_non_negative) without parsing.
select throws_like(
  $$select pg_temp.add_doc('Same person twice', (select user_a from t), (select user_a from t))$$,
  '%documents_originator_not_checker%',
  'and the error names documents_originator_not_checker, not just "a check constraint"');

-- ============================================================
-- 4. The NULL escapes — the reason this is not `is distinct from`
--
-- `null is distinct from null` is FALSE, so the terse form would have made an
-- unstaffed document impossible. The SMDR import (1b.12-1b.15) carries exactly
-- those, and dcs.documents is empty on scl-dev, so nothing would have caught it
-- before the import ran.
-- ============================================================
select lives_ok(
  $$select pg_temp.add_doc('Nobody assigned', null, null)$$,
  'GREEN: a document with NO Originator and NO Checker is accepted — the both-NULL case `is distinct from` would have rejected');

select lives_ok(
  $$select pg_temp.add_doc('Originator only', (select user_a from t), null)$$,
  'GREEN: an Originator with no Checker yet is accepted');

select lives_ok(
  $$select pg_temp.add_doc('Checker only', null, (select user_a from t))$$,
  'GREEN: a Checker with no Originator is accepted');

-- ============================================================
-- 5. What this constraint deliberately does NOT say
--
-- Only the ORIG/CHK pair is written down in docs/00-glossary.md. The other two
-- pairs are asserted as ALLOWED so that adding them later is a visible,
-- deliberate test change rather than something that quietly starts failing.
-- ============================================================
select lives_ok(
  $$select pg_temp.add_doc('Originator approves', (select user_a from t), (select user_b from t), (select user_a from t))$$,
  'GREEN: Originator = Approver is allowed — only the ORIG/CHK pair is a stated rule');

select lives_ok(
  $$select pg_temp.add_doc('Checker approves', (select user_a from t), (select user_b from t), (select user_b from t))$$,
  'GREEN: Checker = Approver is allowed — same reason');

-- ============================================================
-- 6. It holds on UPDATE too, and for every caller
--
-- A CHECK is evaluated on both operations without being asked, which is half
-- the reason this is a constraint rather than a BEFORE INSERT trigger: the
-- 1b.07 document profile will edit staffing, and nothing had to be written
-- here for that path to be covered.
-- ============================================================
-- Inserted with an explicit id rather than looked up by the number add_doc()
-- returns: a volatile function called inside a subquery writes the row, but the
-- surrounding SELECT scans dcs.documents under a snapshot taken before that
-- write, so the lookup came back EMPTY and the UPDATE below silently matched no
-- rows — which reads exactly like "the constraint did not fire". Caught by this
-- file failing on first run.
insert into dcs.documents (id, project_id, title, doc_type_id, discipline_id, area_id,
                           language_id, workflow_status_id, originator_id, checker_id)
select 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid, pej_id, 'For the update test',
       ra_id, disc_id, area_id, en_id, st_id, user_a, user_b
  from t;

create temp table t_doc as
select 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid as id;

select throws_ok(
  $$update dcs.documents set checker_id = (select user_a from t) where id = (select id from t_doc)$$,
  '23514',
  null,
  'RED: moving the Checker onto the Originator by UPDATE is rejected too — a CHECK covers both operations');

select lives_ok(
  $$update dcs.documents set checker_id = (select user_c from t) where id = (select id from t_doc)$$,
  'GREEN: moving the Checker to a third person is fine');

-- Section 4 of the migration's reasoning, asserted: this is a fact about the
-- row, not an authorization rule, so there is no sessionless escape the way
-- enforce_dc_only_numbering() has one. Everything above already ran as
-- postgres — RLS-exempt, trigger-bypassing where a bypass exists — and the
-- refusal happened anyway. This states it outright so the property is named.
select is(
  (select count(*) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and not tgisinternal
      and tgname = 'documents_originator_not_checker'),
  0::bigint,
  'the rule is a constraint and not a trigger — nothing to bypass, nothing to order against the other BEFORE triggers');

select is(
  (select count(*) from dcs.documents where originator_id is not null and originator_id = checker_id),
  0::bigint,
  'and after every statement in this file, no row anywhere has Originator = Checker');

select * from finish();
rollback;
