-- Tests for DCS 1b.03: enforce_dc_only_numbering() now guards INSERT as well
-- as UPDATE, so the CPY number cannot be smuggled in on row creation.
-- Migration 20260918092728_dc_only_numbering_on_insert.
--
-- Pattern follows scl_doc_number_generator.test.sql (the newest test file):
-- fixtures as postgres inside this transaction (rolled back at the end), then
-- impersonation via `set local role authenticated` + request.jwt.claims
-- carrying an explicit aal, exactly like PostgREST.
--
-- The case that matters most here is the one RLS structurally cannot catch: a
-- user holding BOTH orig and dc passes the "Originators insert documents"
-- policy at aal1, so no policy stands between them and a row with a CPY number
-- on it. Only the trigger does. Sections 3 and 4 assert that directly.
--
-- What is deliberately NOT asserted as a DC lock: scl_revision on INSERT.
-- Locking it would mean only a DC at aal2 could create a revision, against
-- docs/00-glossary.md (the Originator creates documents AND revisions). Section
-- 5 asserts the opposite — that an Originator still creates revisions at aal1 —
-- so the decision is a test, not a silence. Its UPDATE guard is untouched and
-- asserted too.
--
-- DCS 1b.08 changed how the column is filled, not who may create a revision: the
-- code is now GENERATED on INSERT (revisions_assign_scl_revision) and a
-- signed-in user who supplies one is refused (scl_revision_generator.test.sql).
-- So the add_rev helper below passes NULL, exactly as the New Revision dialog
-- does, and this file goes through the generator instead of around it. Before
-- 1b.08 it supplied 'B', 'C', 'D' itself; that was the pre-1b.08 rule and is no
-- longer a thing a signed-in user may do.
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-… (project_code SC2602) has an
-- mdr_settings row with cpy_numbering = false, flipped to true below because a
-- project that runs no CPY numbering is refused by 1b.01's
-- enforce_cpy_numbering_enabled() before this rule is ever reached.
-- IT = 094e130b-… (SCMS-IT) has no mdr_settings row at all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and tgname = 'documents_numbering_dc_only'),
  'CREATE TRIGGER documents_numbering_dc_only BEFORE INSERT OR UPDATE ON dcs.documents FOR EACH ROW EXECUTE FUNCTION enforce_dc_only_numbering(''cpy_doc_number'')',
  'documents_numbering_dc_only is BEFORE INSERT OR UPDATE now, with the argument list 1b.01 gave it');

select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_numbering_dc_only'),
  'CREATE TRIGGER revisions_numbering_dc_only BEFORE UPDATE ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_dc_only_numbering(''scl_revision'', ''cpy_revision'')',
  'the UPDATE trigger on dcs.revisions is untouched — still both numbering columns');
select has_trigger('dcs', 'revisions', 'revisions_numbering_dc_only_insert',
  'and a second trigger carries the INSERT side of dcs.revisions');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_numbering_dc_only_insert'),
  'CREATE TRIGGER revisions_numbering_dc_only_insert BEFORE INSERT ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_dc_only_numbering(''cpy_revision'')',
  'it guards cpy_revision ALONE: scl_revision is NOT NULL, so guarding it on INSERT would mean only a DC could create a revision (1b.08 gave that column a generator on INSERT instead, revisions_assign_scl_revision)');

-- BEFORE triggers fire in name order. The CPY-numbering-enabled check must
-- still come first, so a value on a project that runs no CPY track is 23514
-- rather than a question about who the caller is — the order 1b.01 established.
select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and not tgisinternal
      and (tgtype & 2) = 2 and (tgtype & 4) = 4),   -- BEFORE, INSERT
  array['revisions_assign_scl_revision', 'revisions_cpy_numbering',
        'revisions_locked_at_dc_only_insert', 'revisions_locked_at_final_step',
        'revisions_numbering_dc_only_insert', 'revisions_refuse_void_document'],
  'revisions_cpy_numbering still sorts before revisions_numbering_dc_only_insert — and DCS 1b.08''s two BEFORE INSERT triggers sit around them, the generator first and the Void guard last; DCS 1b.10''s two locked_at triggers sit between the CPY check and the numbering one');
select is(
  (select tgname::text from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and not tgisinternal
      and (tgtype & 2) = 2 and (tgtype & 4) = 4
    order by tgname desc limit 1),
  'documents_numbering_dc_only',
  'and on dcs.documents it sorts LAST among the BEFORE INSERT triggers — after the number is assigned and after the CPY track is checked');

-- The function itself: replaced, not re-created, so nothing about its exposure
-- may have moved.
select ok(
  (select not prosecdef from pg_proc where oid = 'public.enforce_dc_only_numbering()'::regprocedure),
  'the function is still SECURITY INVOKER — it reads nothing the caller may not read, so advisor 0029 does not move');
select ok(
  (select proconfig @> array['search_path='] or proconfig @> array['search_path=""']
     from pg_proc where oid = 'public.enforce_dc_only_numbering()'::regprocedure),
  'search_path is still pinned to '''' (advisor 0011)');
select ok(
  (select bool_and(not has_function_privilege(r, 'public.enforce_dc_only_numbering()'::regprocedure, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'no API role gained EXECUTE — the REVOKE in the migration is re-stated, not assumed');
select matches(
  (select prosrc from pg_proc where oid = 'public.enforce_dc_only_numbering()'::regprocedure),
  'tg_op = ''UPDATE''',
  'the body branches on TG_OP — which is the whole change');

-- Asserted, not recreated: the constraint is 1b.01's.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'dcs.documents'::regclass
      and conname = 'documents_project_id_cpy_doc_number_key'),
  'UNIQUE (project_id, cpy_doc_number)',
  'the CPY number is unique WITHIN the project, not globally — 1b.01''s constraint, untouched by this task');

-- ============================================================
-- 2. Fixtures
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
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid, 'orig-1b03@example.com', 'Originator 1b03'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid, 'dc-1b03@example.com', 'DC 1b03'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3'::uuid, 'both-1b03@example.com', 'Originator and DC 1b03')
) as u(id, email, name);

create temp table t as
select
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid as orig_id,
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid as dc_id,
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'::uuid as both_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,   -- SC2602
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,    -- SCMS-IT
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid as host_doc_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as en_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as st_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC') as step_id;
grant select on t to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select f.pej_id, u.user_id, u.role::dcs.project_role
  from t f
 cross join lateral (values
   (f.orig_id, 'orig'), (f.dc_id, 'dc'),
   (f.both_id, 'orig'), (f.both_id, 'dc')
 ) as u(user_id, role);

-- Without this every CPY assertion below would be answered by 1b.01's
-- enforce_cpy_numbering_enabled() with 23514, and this rule never reached.
update dcs.mdr_settings set cpy_numbering = true where project_id = (select pej_id from t);
-- SCMS-IT has no row at all; the cross-project uniqueness case in section 7
-- needs one.
insert into dcs.mdr_settings (project_id, cpy_numbering)
select it_id, true from t;

-- A host document and one revision, written with no session — which is itself
-- the bypass this task must not break, asserted properly in section 6.
insert into dcs.documents (id, project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select host_doc_id, pej_id, 'Host document', ra_id, disc_id, area_id, en_id, st_id from t;
insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id)
select host_doc_id, pej_id, 'A', step_id, st_id from t;

-- A reusable INSERT that leaves scl_doc_number to the 1b.02 generator.
create function pg_temp.add_doc(p_cpy text, p_title text) returns text
  language sql as $$
  insert into dcs.documents (project_id, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
  select pej_id, p_cpy, p_title, ra_id, disc_id, area_id, en_id, st_id from t
  returning scl_doc_number;
$$;
create function pg_temp.add_rev(p_cpy text) returns text
  language sql as $$
  insert into dcs.revisions (document_id, project_id, cpy_revision, step_id, status_id)
  select host_doc_id, pej_id, p_cpy, step_id, st_id from t
  returning scl_revision;
$$;

-- ============================================================
-- 3. dcs.documents on INSERT — the hole this task closes
-- ============================================================
set local role authenticated;

-- A non-DC Originator at aal1: the caller who passes "Originators insert
-- documents" and, before this migration, wrote the CPY number unchallenged.
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$select pg_temp.add_doc('REFUSED-001', 'ORIG supplies a client number')$$,
  '42501', null,
  'RED: a non-DC project member INSERTing a document with cpy_doc_number filled is refused (42501) — the hole 1b.01 named and left open');
select is(
  (select count(*) from dcs.documents where cpy_doc_number = 'REFUSED-001'),
  0::bigint,
  'and the refused row was not written');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and new_value ->> 'cpy_doc_number' = 'REFUSED-001'),
  0::bigint,
  'a refused INSERT leaves no audit_log row — this is a BEFORE trigger, so nothing reached the AFTER trigger');

select lives_ok(
  $$select pg_temp.add_doc(null, 'ORIG creates an ordinary document')$$,
  'GREEN: the same non-DC member INSERTing with cpy_doc_number NULL succeeds — creating a document must not require the DC role');

-- The DC, with and without the second factor.
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$select pg_temp.add_doc('CLIENT-001', 'DC creates a document with the client number on it')$$,
  'GREEN: the DC of the project in an aal2 session may do it');
select is(
  (select cpy_doc_number from dcs.documents where title = 'DC creates a document with the client number on it'),
  'CLIENT-001',
  'and the value is stored, not silently dropped');

select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$select pg_temp.add_doc('CLIENT-002', 'DC without a second factor')$$,
  '42501', null,
  'RED: the same DC in a session without aal2 is refused (42501) — the trigger reaches the caller before the INSERT policy does, so the message names the rule');

-- The case RLS structurally cannot catch: orig AND dc, at aal1. The Originator
-- policy lets the row through; only the trigger stands between them and the
-- number.
select set_config('request.jwt.claims',
  json_build_object('sub', (select both_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select lives_ok(
  $$select pg_temp.add_doc(null, 'orig+dc at aal1 creates an ordinary document')$$,
  'GREEN: someone holding orig as well as dc inserts at aal1 — they pass the Originator policy, which asks for no second factor');
select throws_ok(
  $$select pg_temp.add_doc('CLIENT-003', 'orig+dc at aal1 supplies a client number')$$,
  '42501', null,
  'RED: the same caller supplying cpy_doc_number IS refused — no policy could have caught this one, which is why the rule is a trigger');

-- ============================================================
-- 4. dcs.revisions on INSERT — cpy_revision, the same four cases
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$select pg_temp.add_rev('CLIENT-REV-B')$$,
  '42501', null,
  'RED: a non-DC member INSERTing a revision with cpy_revision filled is refused (42501)');
select is(
  (select count(*) from dcs.revisions where cpy_revision = 'CLIENT-REV-B'),
  0::bigint,
  'and that revision was not written');
select lives_ok(
  $$select pg_temp.add_rev(null)$$,
  'GREEN: the same member creates the revision with cpy_revision NULL');

select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$select pg_temp.add_rev('CLIENT-REV-C')$$,
  '42501', null,
  'RED: the DC without aal2 is refused on the revision too');

select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$select pg_temp.add_rev('CLIENT-REV-C')$$,
  'GREEN: the DC at aal2 may create a revision carrying the client''s revision marker');
select is(
  (select cpy_revision from dcs.revisions where scl_revision = 'C'),
  'CLIENT-REV-C',
  'and it is stored');

-- ============================================================
-- 5. scl_revision: INSERT is not a DC lock, UPDATE deliberately closed
--
-- This section is the decision of 1b.03 written down as assertions rather than
-- as a comment: creating a revision is not a DC-only act. Since 1b.08 the
-- Originator gets the code from the generator rather than typing it.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select lives_ok(
  $$select pg_temp.add_rev(null)$$,
  'GREEN, by decision: an Originator at aal1 still creates revisions, leaving scl_revision to the generator — a DC lock on INSERT would make revision creation a DC-only act (docs/00-glossary.md: the Originator creates documents and revisions)');
select throws_ok(
  $$update dcs.revisions set scl_revision = 'D2' where scl_revision = 'D'$$,
  '42501', null,
  'RED: the same Originator CHANGING scl_revision afterwards is still refused (42501) — 1b.01''s UPDATE guard, untouched');

select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$update dcs.revisions set scl_revision = 'D2' where scl_revision = 'D'$$,
  'GREEN: the DC at aal2 changes it, exactly as before this migration');

-- ============================================================
-- 6. Every existing UPDATE-side behaviour, and the sessionless bypass
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$update dcs.documents set cpy_doc_number = 'HIJACK' where id = (select host_doc_id from t)$$,
  '42501', null,
  'RED: a non-DC member UPDATING cpy_doc_number is refused (42501) — unchanged from 1b.01');
select lives_ok(
  $$update dcs.documents set title = 'Retitled by the Originator' where id = (select host_doc_id from t)$$,
  'GREEN: and an ordinary column on the same row is still theirs to edit — the rule is about the number, not the row');

select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok(
  $$update dcs.documents set cpy_doc_number = 'CLIENT-100' where id = (select host_doc_id from t)$$,
  'GREEN: the DC at aal2 sets the CPY number of an existing document');
select lives_ok(
  $$update dcs.documents set cpy_doc_number = 'CLIENT-200' where id = (select host_doc_id from t)$$,
  'GREEN: and changes it again');
reset role;

-- The audit trail the brief asks for: the change, with what was there before.
select is(
  (select old_value #>> '{}' from public.audit_log
    where table_name = 'dcs.documents' and field_name = 'cpy_doc_number'
      and new_value #>> '{}' = 'CLIENT-200'),
  'CLIENT-100',
  'the CPY change is in public.audit_log WITH its previous value (brief §6.4)');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and field_name = 'cpy_doc_number'
      and user_id = (select dc_id from t)
      and project_id = (select pej_id from t)),
  2::bigint,
  'both CPY writes are attributed to the DC who made them and scoped to the project, so the project''s DC can read them (1a.09)');

-- No session: a migration, supabase/seed.sql, psql, service_role. Breaking
-- this breaks the seed path, so it is asserted on both tables.
--
-- `reset role` alone is NOT a sessionless state: request.jwt.claims is set for
-- the whole transaction, and auth.uid() reads it whatever the current role is.
-- Clearing it is what makes the next assertions prove the bypass instead of
-- quietly re-proving the DC path.
select set_config('request.jwt.claims', null, true);
select is(coalesce(auth.uid()::text, '<no session>'), '<no session>',
  'the session is now genuinely absent — auth.uid() is NULL, as it is in a migration or in psql');

select lives_ok(
  $$select pg_temp.add_doc('SEED-CLIENT-001', 'Written with no session at all')$$,
  'GREEN: a sessionless caller INSERTs a document with the CPY number already filled — the auth.uid() bypass survives, on INSERT as well as UPDATE');
select is(
  (select cpy_doc_number from dcs.documents where title = 'Written with no session at all'),
  'SEED-CLIENT-001',
  'and the value went in verbatim');
select lives_ok(
  $$select pg_temp.add_rev('SEED-CLIENT-REV')$$,
  'GREEN: the same holds for a revision');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and new_value ->> 'cpy_doc_number' = 'SEED-CLIENT-001'
      and user_id is null),
  1::bigint,
  'the sessionless INSERT is audited with no user_id — visible, and honest about having had no session');

-- ============================================================
-- 7. The 1b.01 constraint this task only asserts
-- ============================================================
select throws_ok(
  $$select pg_temp.add_doc('CLIENT-001', 'A second document with the same client number')$$,
  '23505', null,
  'RED: a duplicate cpy_doc_number within one project is rejected (23505) by documents_project_id_cpy_doc_number_key');
select lives_ok(
  $$insert into dcs.documents (project_id, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'CLIENT-001', 'The same client number on another project', ra_id, disc_id, area_id, en_id, st_id from t$$,
  'GREEN: the same value in a DIFFERENT project is accepted — the CPY number is the client''s, and two clients may use the same string');
select is(
  (select count(distinct project_id) from dcs.documents where cpy_doc_number = 'CLIENT-001'),
  2::bigint,
  'so one CPY number now exists on two projects at once, which is what "unique within the project" means');

-- And the CPY track still cannot be opened on a project that does not run one:
-- 1b.01's check fires first, before this rule asks who the caller is.
delete from dcs.mdr_settings where project_id = (select it_id from t);
select throws_ok(
  $$insert into dcs.documents (project_id, cpy_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'CLIENT-999', 'No CPY track here', ra_id, disc_id, area_id, en_id, st_id from t$$,
  '23514', null,
  'RED: with no mdr_settings row the CPY value is still 23514, not 42501 — revisions_cpy_numbering / documents_cpy_numbering sorts first and answers first');

select * from finish();
rollback;
