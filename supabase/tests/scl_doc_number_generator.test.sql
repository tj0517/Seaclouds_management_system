-- Tests for DCS 1b.02: the SCL document-number generator —
-- dcs.next_doc_number(), the BEFORE INSERT trigger documents_assign_scl_number
-- and the dcs.import_mode escape hatch.
-- Migration 20260918085125_scl_doc_number_generator.
--
-- Pattern follows rls_document_register.test.sql (the newest test file):
-- fixtures as postgres inside this transaction (rolled back at the end), then
-- impersonation via `set local role authenticated` + request.jwt.claims
-- carrying an explicit aal, exactly like PostgREST.
--
-- What this file deliberately does and does not prove about atomicity:
--
--   * It asserts that pg_advisory_xact_lock over PROJECT+TYPE is in the
--     function body, and that twenty inserts in a row produce 0001..0020 with
--     no gap and no duplicate.
--   * It cannot prove the CONCURRENT case: pgTAP runs inside one transaction
--     on one connection, and a transaction never races itself. The real proof
--     is twenty parallel psql sessions, run by hand against the local stack
--     with the lock line removed (duplicates appear) and restored (they do
--     not) — reported in the PR, not runnable here.
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-… has project_code SC2602;
-- IT = 094e130b-… has project_code SCMS-IT, which CONTAINS A HYPHEN and is
-- therefore the case that breaks any parser counting fields from the left.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select has_function('dcs', 'next_doc_number',
  array['uuid', 'uuid', 'uuid', 'text'],
  'dcs.next_doc_number(uuid, uuid, uuid, text) exists');
select function_returns('dcs', 'next_doc_number',
  array['uuid', 'uuid', 'uuid', 'text'], 'text',
  'dcs.next_doc_number returns the ready-made number as text');
select is(
  (select pg_get_function_arguments(oid)
     from pg_proc where oid = 'dcs.next_doc_number(uuid,uuid,uuid,text)'::regprocedure),
  'p_project_id uuid, p_doc_type_id uuid, p_language_id uuid, p_orig text DEFAULT ''SCL''::text',
  'the signature is the one the task specified, ORIG defaulting to SCL');

select has_function('public', 'assign_scl_doc_number', array[]::text[],
  'public.assign_scl_doc_number() exists');
select has_trigger('dcs', 'documents', 'documents_assign_scl_number',
  'documents_assign_scl_number is attached to dcs.documents');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and tgname = 'documents_assign_scl_number'),
  'CREATE TRIGGER documents_assign_scl_number BEFORE INSERT ON dcs.documents FOR EACH ROW EXECUTE FUNCTION assign_scl_doc_number()',
  'it is BEFORE INSERT FOR EACH ROW — so it can fill the column before NOT NULL is checked, and INSERT only, leaving the UPDATE side to 1b.01');

-- BEFORE triggers fire in name order; this one has to sort first so the number
-- exists before any other guard reports on the row.
select is(
  (select tgname from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and not tgisinternal
      and (tgtype & 2) = 2 and (tgtype & 4) = 4   -- BEFORE, INSERT
    order by tgname limit 1),
  'documents_assign_scl_number',
  'it sorts first among the BEFORE INSERT triggers of dcs.documents');

-- The advisory lock is the whole atomicity claim — assert it is in the body.
select matches(
  (select prosrc from pg_proc where oid = 'dcs.next_doc_number(uuid,uuid,uuid,text)'::regprocedure),
  'pg_advisory_xact_lock\(hashtext\(',
  'the body takes pg_advisory_xact_lock(hashtext(...)) — a transaction-scoped lock, held past the read to commit');
select isnt_empty(
  $$select 1 from pg_proc
     where oid = 'dcs.next_doc_number(uuid,uuid,uuid,text)'::regprocedure
       and position('pg_advisory_xact_lock' in prosrc)
         < position('select coalesce(max(' in prosrc)$$,
  'and it takes the lock BEFORE reading the maximum — the other order is the race it exists to close');

-- Both functions: search_path pinned (advisor 0011), SECURITY DEFINER by
-- decision, and EXECUTE revoked from every API role so advisor 0029 does not
-- move (it counts only SECURITY DEFINER functions authenticated may execute).
select ok(
  (select bool_and(p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('dcs.next_doc_number(uuid,uuid,uuid,text)'::regprocedure,
                    'public.assign_scl_doc_number()'::regprocedure)),
  'both 1b.02 functions have search_path pinned to ''''');
select ok(
  (select bool_and(p.prosecdef)
     from pg_proc p
    where p.oid in ('dcs.next_doc_number(uuid,uuid,uuid,text)'::regprocedure,
                    'public.assign_scl_doc_number()'::regprocedure)),
  'both are SECURITY DEFINER — the maximum must be taken over every row, not only the rows the caller''s policies show them');
select ok(
  (select bool_and(not has_function_privilege(r, p.oid, 'execute'))
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid in ('dcs.next_doc_number(uuid,uuid,uuid,text)'::regprocedure,
                    'public.assign_scl_doc_number()'::regprocedure)),
  'no API role can execute either — so neither is an RPC endpoint and advisor 0029 stays at 12 (dcs is an exposed API schema, so the revoke is what makes this true)');

-- 1b.01's UPDATE-side trigger is untouched.
select has_trigger('dcs', 'documents', 'documents_scl_number_immutable',
  'the 1b.01 immutability trigger is still attached — 1b.02 does not re-implement it');

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
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'orig-1b02@example.com', 'Originator 1b02')
) as u(id, email, name);

create temp table t_num as
select
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid as orig_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,   -- project_code SC2602
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,    -- project_code SCMS-IT
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as ra_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'AS') as as_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'TN') as tn_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as discipline_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as en_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'PL') as pl_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as status_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'VOID') as void_id;
grant select on t_num to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select pej_id, orig_id, 'orig'::dcs.project_role from t_num;

-- The register starts empty (nothing in supabase/seed.sql writes it), which is
-- what makes the first generated SEQ assertable as 0001.
select is((select count(*) from dcs.documents), 0::bigint,
  'the register is empty before this file writes to it');

-- A reusable INSERT that leaves scl_doc_number alone.
create function pg_temp.add_doc(p_project uuid, p_type uuid, p_lang uuid, p_title text)
  returns text language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
  select p_project, p_title, p_type, discipline_id, area_id, p_lang, status_id from t_num
  returning scl_doc_number;
$$;

-- ============================================================
-- 3. The number the generator produces
-- ============================================================
select is(
  (select pg_temp.add_doc(pej_id, ra_id, en_id, 'First report') from t_num),
  'SC2602-SCL-RA-0001-EN',
  'GREEN: an INSERT with scl_doc_number left NULL gets PROJECT-ORIG-TYPE-SEQ-LANG, SEQ starting at 0001');
select is(
  (select count(*) from dcs.documents where scl_doc_number is null),
  0::bigint,
  'and the NOT NULL column is satisfied — a BEFORE trigger fills it before the constraint is checked');

select is(
  (select pg_temp.add_doc(pej_id, ra_id, en_id, 'Second report') from t_num),
  'SC2602-SCL-RA-0002-EN',
  'the next document of the same PROJECT + TYPE is 0002');
select is(
  (select pg_temp.add_doc(pej_id, as_id, en_id, 'First study') from t_num),
  'SC2602-SCL-AS-0001-EN',
  'a different TYPE in the same project starts its own count at 0001 — SEQ is per PROJECT + TYPE');
select is(
  (select pg_temp.add_doc(pej_id, ra_id, pl_id, 'Third report, Polish') from t_num),
  'SC2602-SCL-RA-0003-PL',
  'LANG does NOT scope the count: the Polish report is 0003, not a second 0001');

-- The hyphenated project code, which is why the SEQ parser reads from the right.
select is(
  (select pg_temp.add_doc(it_id, ra_id, en_id, 'IT report') from t_num),
  'SCMS-IT-SCL-RA-0001-EN',
  'a different PROJECT starts at 0001 — and SCMS-IT puts a hyphen inside the PROJECT field');
select is(
  (select pg_temp.add_doc(it_id, ra_id, en_id, 'Second IT report') from t_num),
  'SCMS-IT-SCL-RA-0002-EN',
  'and the generator parses its own six-field output back correctly: 0002, not 0001 again');

-- Called directly, it is a pure read: no row, no side effect, same answer twice.
select is(
  (select dcs.next_doc_number(pej_id, ra_id, en_id) from t_num),
  'SC2602-SCL-RA-0004-EN',
  'called directly the function returns the next number without inserting anything');
select is(
  (select dcs.next_doc_number(pej_id, ra_id, en_id) from t_num),
  'SC2602-SCL-RA-0004-EN',
  'and calling it again returns the same number — it draws nothing, the table is the record of what was issued');
select is(
  (select count(*) from dcs.documents where project_id = (select pej_id from t_num)),
  4::bigint,
  'two direct calls created no rows');

select is(
  (select dcs.next_doc_number(pej_id, ra_id, en_id, 'CPY') from t_num),
  'SC2602-CPY-RA-0004-EN',
  'p_orig replaces the ORIG field — the default SCL is a default, not a constant');

-- ============================================================
-- 4. Void: the freed number never comes back
-- ============================================================
update dcs.documents
   set workflow_status_id = (select void_id from t_num)
 where scl_doc_number = 'SC2602-SCL-RA-0003-PL';
select is(
  (select code from dcs.dictionaries d
     join dcs.documents doc on doc.workflow_status_id = d.id
    where doc.scl_doc_number = 'SC2602-SCL-RA-0003-PL'),
  'VOID',
  'the third report is now Void');
select is(
  (select pg_temp.add_doc(pej_id, ra_id, en_id, 'Fourth report') from t_num),
  'SC2602-SCL-RA-0004-EN',
  'the document after a Void gets the FOLLOWING number (0004), not the Voided one — docs/00-glossary.md: a Void number never returns to the pool');

-- And a gap in the middle is not back-filled either.
set local dcs.import_mode = 'on';
insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select pej_id, 'SC2602-SCL-RA-0009-EN', 'Jumped ahead', ra_id, discipline_id, area_id, en_id, status_id from t_num;
set local dcs.import_mode = 'off';
select is(
  (select pg_temp.add_doc(pej_id, ra_id, en_id, 'After the gap') from t_num),
  'SC2602-SCL-RA-0010-EN',
  'with 0005..0008 free, the next number is still max + 1 = 0010 — gaps are never filled');

-- ============================================================
-- 5. Manual entry is refused; the import hatch is the only way past it
-- ============================================================
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'SC2602-SCL-RA-0500-EN', 'By hand', ra_id, discipline_id, area_id, en_id, status_id from t_num$$,
  '23001', null,
  'RED: an INSERT supplying scl_doc_number is rejected (23001) — as postgres, so there is no role that may hand-enter a number');
select is(
  (select count(*) from dcs.documents where scl_doc_number = 'SC2602-SCL-RA-0500-EN'),
  0::bigint,
  'and the refused row was not written');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and new_value ->> 'scl_doc_number' = 'SC2602-SCL-RA-0500-EN'),
  0::bigint,
  'a refused INSERT leaves no audit_log row — a BEFORE trigger raised, so nothing reached the AFTER trigger');

-- An empty string is not NULL, and must not be smuggled through as "unset".
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, '', 'Empty string', ra_id, discipline_id, area_id, en_id, status_id from t_num$$,
  '23001', null,
  'RED: an empty-string scl_doc_number is a supplied number too, not an absent one');

set local dcs.import_mode = 'on';
select lives_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'LEGACY/SMDR/0042', 'Imported from the Excel SMDR', ra_id, discipline_id, area_id, en_id, status_id from t_num$$,
  'GREEN: with dcs.import_mode = ''on'' the supplied number is accepted');
select is(
  (select scl_doc_number from dcs.documents where title = 'Imported from the Excel SMDR'),
  'LEGACY/SMDR/0042',
  'and it is stored VERBATIM — the import owns the format of what it carries, including numbers that were never SCL-shaped');
select is(
  (select pg_temp.add_doc(pej_id, ra_id, en_id, 'After the legacy import') from t_num),
  'SC2602-SCL-RA-0011-EN',
  'an unparseable legacy number contributes nothing to the maximum: the count continues from 0010, and the global UNIQUE is the backstop if that ever collides');

-- A legacy number with fewer than four digits still counts — the reason the
-- SEQ parser is lenient rather than strict about the padding.
insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select pej_id, 'SC2602-SCL-TN-12-EN', 'Legacy two-digit SEQ', tn_id, discipline_id, area_id, en_id, status_id from t_num;
set local dcs.import_mode = 'off';
select is(
  (select pg_temp.add_doc(pej_id, tn_id, en_id, 'After the two-digit legacy') from t_num),
  'SC2602-SCL-TN-0013-EN',
  'a legacy SC2602-SCL-TN-12-EN counts as SEQ 12, so the next is 0013 — strict four-digit parsing would have restarted this type at 0001');

select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'SC2602-SCL-RA-0600-EN', 'After the hatch closed', ra_id, discipline_id, area_id, en_id, status_id from t_num$$,
  '23001', null,
  'RED: with the hatch set back to ''off'' a supplied number is refused again — the GUC is per session, not a permanent switch');

-- ============================================================
-- 6. The UPDATE side is 1b.01's and still holds (asserted, not rewritten)
-- ============================================================
select throws_ok(
  $$update dcs.documents set scl_doc_number = 'SC2602-SCL-RA-9999-EN'
     where scl_doc_number = 'SC2602-SCL-RA-0001-EN'$$,
  '23001', null,
  'RED: an UPDATE of scl_doc_number is still rejected (23001) — forbid_scl_doc_number_change() from 1b.01, unchanged by this migration');
select is(
  (select count(*) from dcs.documents where scl_doc_number = 'SC2602-SCL-RA-0001-EN'),
  1::bigint,
  'and the number it guards is untouched');
select throws_ok(
  $$update dcs.documents set scl_doc_number = null
     where scl_doc_number = 'SC2602-SCL-RA-0001-EN'$$,
  '23001', null,
  'RED: nulling scl_doc_number to "make it regenerate" is the same forbidden change — the INSERT trigger is no back door out of immutability');

-- ============================================================
-- 7. Arguments the generator refuses to guess about
-- ============================================================
select throws_ok(
  $$select dcs.next_doc_number('00000000-0000-0000-0000-000000000000'::uuid,
      (select ra_id from t_num), (select en_id from t_num))$$,
  '22023', null,
  'RED: an unknown project raises 22023 — the PROJECT segment cannot be resolved');
select throws_ok(
  $$select dcs.next_doc_number((select pej_id from t_num),
      (select en_id from t_num), (select en_id from t_num))$$,
  '22023', null,
  'RED: a language dictionary row passed as the doc type raises 22023 — the dict_type is checked here too, because this runs BEFORE 1b.01''s composite FKs');
select throws_ok(
  $$select dcs.next_doc_number((select pej_id from t_num),
      (select ra_id from t_num), (select ra_id from t_num))$$,
  '22023', null,
  'RED: a doc_type row passed as the language raises 22023');
select throws_ok(
  $$select dcs.next_doc_number((select pej_id from t_num),
      (select ra_id from t_num), (select en_id from t_num), 'SC-L')$$,
  '22023', null,
  'RED: an ORIG containing a separator raises 22023 — it would add a field to the number and break the SEQ parser');
select throws_ok(
  $$select dcs.next_doc_number((select pej_id from t_num),
      (select ra_id from t_num), (select en_id from t_num), '')$$,
  '22023', null,
  'RED: an empty ORIG raises 22023 rather than producing SC2602--RA-0004-EN');
select is(
  (select dcs.next_doc_number(pej_id, ra_id, en_id, ' scl ') from t_num),
  'SC2602-SCL-RA-0012-EN',
  'ORIG is trimmed and upper-cased before it is judged — '' scl '' is the SCL track, not a rejection');

-- ============================================================
-- 8. Twenty in a row: consecutive, no gap, no duplicate
--
-- Sequential, not concurrent — see the header. What this does prove is that
-- nothing in the generator skips or repeats when the register is being filled
-- as fast as one transaction can fill it.
-- ============================================================
select is(
  (select count(*) from generate_series(1, 20) g
    cross join lateral (select pg_temp.add_doc(
      (select pej_id from t_num), (select as_id from t_num),
      (select en_id from t_num), 'Bulk ' || g)) as ins(num)),
  20::bigint,
  'twenty consecutive inserts into the same PROJECT + TYPE all succeed');
select results_eq(
  $$select scl_doc_number from dcs.documents
     where project_id = (select pej_id from t_num)
       and doc_type_id = (select as_id from t_num)
     order by scl_doc_number$$,
  $$select 'SC2602-SCL-AS-' || lpad(g::text, 4, '0') || '-EN'
      from generate_series(1, 21) g$$,
  'and they are 0002..0021 after the 0001 from section 3 — twenty-one distinct consecutive numbers, no gap, no duplicate');

-- ============================================================
-- 9. The same thing through RLS, as a signed-in Originator
--
-- This is the assertion that the SECURITY DEFINER chain actually works for a
-- real caller: assign_scl_doc_number() calls dcs.next_doc_number(), which no
-- API role may EXECUTE, and EXECUTE on a call inside a function body IS
-- checked at run time.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t_num), 'role', 'authenticated', 'aal', 'aal1')::text,
  true);
select is(
  (select pg_temp.add_doc(
     (select pej_id from t_num), (select tn_id from t_num),
     (select en_id from t_num), 'Written by the Originator')),
  'SC2602-SCL-TN-0014-EN',
  'GREEN: a signed-in Originator at aal1 inserts with a NULL number and gets one — no 42501, although they may not execute either function themselves');
select throws_ok(
  $$insert into dcs.documents (project_id, scl_doc_number, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'SC2602-SCL-TN-0700-EN', 'Originator picks a number', tn_id, discipline_id, area_id, en_id, status_id from t_num$$,
  '23001', null,
  'RED: the same Originator supplying a number is refused — "manual entry impossible" holds for the role that creates documents');
reset role;

-- The document the Originator created is a normal, audited row.
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and action = 'INSERT'
      and new_value ->> 'scl_doc_number' = 'SC2602-SCL-TN-0014-EN'
      and user_id = (select orig_id from t_num)),
  1::bigint,
  'and the generated number is in the audit_log, attributed to the session that made it');

select * from finish();
rollback;
