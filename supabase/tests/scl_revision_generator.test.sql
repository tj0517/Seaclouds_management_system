-- Tests for DCS 1b.08: the SCL revision-number generator —
-- dcs.next_revision_code(), the BEFORE INSERT trigger
-- revisions_assign_scl_revision, the RETCOM refusal, the Void-document guard
-- revisions_refuse_void_document and the dcs.import_mode / session-less
-- exceptions. Migration 20260920134700_scl_revision_generator.
--
-- Pattern follows scl_doc_number_generator.test.sql (the 1b.02 file this one
-- mirrors): fixtures as postgres inside this transaction (rolled back at the
-- end), then impersonation via `set local role authenticated` +
-- request.jwt.claims carrying an explicit aal, exactly like PostgREST.
--
-- What this file cannot prove about atomicity: pgTAP runs inside one
-- transaction on one connection, and a transaction never races itself. It
-- asserts that pg_advisory_xact_lock over DOCUMENT + SERIES is in the function
-- body and is taken before the read. The concurrent proof is parallel psql
-- sessions run by hand against the local stack, with the lock line removed
-- (duplicates appear) and restored (they do not) — reported in the PR.
--
-- WHO MAY SUPPLY scl_revision (section 5) is the task's rule, and it is the part
-- of this file that was first written wrong and corrected: a signed-in user who
-- supplies a code is refused with 42501 (insufficient_privilege) unless they are
-- the project's DC in an aal2 session, in which case the code is accepted and
-- checked against the step's series. A first version refused the DC as well
-- (23001) — the pattern of the document number — which contradicted the task.
--
-- The promotion half (current_revision_id, NOT_STARTED -> STARTED,
-- SUPERSEDED) is revision_promotion.test.sql. Every insert below therefore
-- also runs that trigger; nothing here asserts on its effects.
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select has_function('dcs', 'next_revision_code', array['uuid', 'uuid'],
  'dcs.next_revision_code(uuid, uuid) exists');
select function_returns('dcs', 'next_revision_code', array['uuid', 'uuid'], 'text',
  'and returns the ready-made code as text');
select is(
  (select pg_get_function_arguments(oid)
     from pg_proc where oid = 'dcs.next_revision_code(uuid,uuid)'::regprocedure),
  'p_document_id uuid, p_step_id uuid',
  'the signature is (document, step)');

-- Decision 2: an INVOKER with an explicit search_path — an invoker does not
-- inherit the definer hardening, so a mutable path here would be a real hole.
select ok(
  not (select prosecdef from pg_proc where oid = 'dcs.next_revision_code(uuid,uuid)'::regprocedure),
  'it is SECURITY INVOKER — RLS scopes what the caller sees, and advisor 0029 (which counts definers) does not move');
select ok(
  (select proconfig @> array['search_path=""']
     from pg_proc where oid = 'dcs.next_revision_code(uuid,uuid)'::regprocedure),
  'and its search_path is pinned to '''' — the invoker does not inherit the definer''s hardening, so it is set explicitly');
select ok(
  has_function_privilege('authenticated', 'dcs.next_revision_code(uuid,uuid)', 'execute'),
  'authenticated can EXECUTE it (the New Revision dialog proposes a code through it)');
select ok(
  not has_function_privilege('anon', 'dcs.next_revision_code(uuid,uuid)', 'execute'),
  'anon cannot');

-- The one place that says what a valid code looks like.
select is(
  (select array_agg(dcs.revision_series_pattern(c) order by c)
     from unnest(array['IDC', 'IFR', 'IFC', 'IFI', 'IFB']) c),
  array['^[A-Z]$', '^[1-9][0-9]{0,5}$', '^[1-9][0-9]{0,5}$', '^[1-9][0-9]{0,5}$', '^[0-9]{2}$'],
  'dcs.revision_series_pattern gives one capital letter for IDC, two digits for IFR and a plain number for IFC / IFI / IFB');
select is(
  (select count(*) from unnest(array['RETCOM', 'XYZ']) c where dcs.revision_series_pattern(c) is not null),
  0::bigint,
  'and NULL for RETCOM and for a step nobody defined a series for');
select ok(
  (select not p.prosecdef and p.provolatile = 'i' and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'dcs.revision_series_pattern(text)'::regprocedure),
  'it is IMMUTABLE, SECURITY INVOKER and has its search_path pinned — not a definer authenticated can execute, so advisor 0029 does not move');
select ok(
  has_function_privilege('authenticated', 'dcs.revision_series_pattern(text)', 'execute')
    and not has_function_privilege('anon', 'dcs.revision_series_pattern(text)', 'execute'),
  'authenticated can execute it (next_revision_code, an invoker, calls it with the caller''s rights); anon cannot');

select has_function('public', 'assign_scl_revision', array[]::text[],
  'public.assign_scl_revision() exists');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_assign_scl_revision'),
  'CREATE TRIGGER revisions_assign_scl_revision BEFORE INSERT ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION assign_scl_revision()',
  'revisions_assign_scl_revision is BEFORE INSERT FOR EACH ROW — it fills the column before NOT NULL is checked, and INSERT only, leaving the UPDATE side to 1b.01');
select is(
  (select tgname from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and not tgisinternal
      and (tgtype & 2) = 2 and (tgtype & 4) = 4   -- BEFORE, INSERT
    order by tgname limit 1),
  'revisions_assign_scl_revision',
  'it sorts first among the BEFORE INSERT triggers of dcs.revisions, so the code exists before any other guard reports on the row');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_refuse_void_document'),
  'CREATE TRIGGER revisions_refuse_void_document BEFORE INSERT ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION refuse_revision_on_void_document()',
  'revisions_refuse_void_document is BEFORE INSERT FOR EACH ROW');
select has_trigger('dcs', 'revisions', 'revisions_numbering_dc_only',
  'the 1b.01 UPDATE-side trigger is still attached — 1b.08 does not re-implement it');

select matches(
  (select prosrc from pg_proc where oid = 'dcs.next_revision_code(uuid,uuid)'::regprocedure),
  'pg_advisory_xact_lock\(\s*hashtext\(',
  'the body takes pg_advisory_xact_lock(hashtext(...)) — a transaction-scoped lock, held past the read to commit');
select isnt_empty(
  $$select 1 from pg_proc
     where oid = 'dcs.next_revision_code(uuid,uuid)'::regprocedure
       and position('pg_advisory_xact_lock' in prosrc)
         < position('select max(' in prosrc)$$,
  'and it takes the lock BEFORE reading the maximum — the other order is the race it exists to close');

select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('public.assign_scl_revision()'::regprocedure,
                    'public.refuse_revision_on_void_document()'::regprocedure)),
  'both trigger functions are SECURITY DEFINER with search_path pinned to ''''');
select ok(
  (select bool_and(not has_function_privilege(r, p.oid, 'execute'))
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid in ('public.assign_scl_revision()'::regprocedure,
                    'public.refuse_revision_on_void_document()'::regprocedure)),
  'and no API role can execute either — trigger functions, not RPC endpoints, so advisor 0029 stays at 12');

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
  ('ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid, 'orig-1b08g@example.com', 'Originator 1b08g'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid, 'dc-1b08g@example.com', 'DC 1b08g'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff3'::uuid, 'out-1b08g@example.com', 'Outsider 1b08g'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff4'::uuid, 'both-1b08g@example.com', 'Originator and DC 1b08g')
) as u(id, email, name);

create temp table t as
select
  'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid as orig_id,
  'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid as dc_id,
  'ffffffff-ffff-4fff-8fff-fffffffffff3'::uuid as out_id,
  'ffffffff-ffff-4fff-8fff-fffffffffff4'::uuid as both_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,   -- SC2602, has mdr_settings from the seed
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as en_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC') as s_idc,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IFR') as s_ifr,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'RETCOM') as s_retcom,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IFC') as s_ifc,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IFI') as s_ifi,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IFB') as s_ifb,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IDC') as st_idc,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IFR') as st_ifr;
grant select on t to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select pej_id, orig_id, 'orig'::dcs.project_role from t
union all
select pej_id, dc_id, 'dc'::dcs.project_role from t
union all
select pej_id, both_id, 'orig'::dcs.project_role from t
union all
select pej_id, both_id, 'dc'::dcs.project_role from t;

-- Six documents on PEJ, none with a revision: d1 the main ladder, d2 a second
-- document for isolation and for step-versus-value, d3 leniency, d4 the
-- ceilings, d5 the exceptions, dv a Void document. The document number comes
-- from the 1b.02 generator (this runs with no session).
create function pg_temp.add_doc(p_title text, p_status text default 'NOT_STARTED') returns uuid
  language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
  select pej_id, p_title, ra_id, disc_id, area_id, en_id,
         (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = p_status)
    from t
  returning id;
$$;
create temp table t_doc as
select pg_temp.add_doc('d1 ladder') as d1,
       pg_temp.add_doc('d2 second document') as d2,
       pg_temp.add_doc('d3 leniency') as d3,
       pg_temp.add_doc('d4 ceilings') as d4,
       pg_temp.add_doc('d5 exceptions') as d5,
       pg_temp.add_doc('dv void', 'VOID') as dv,
       pg_temp.add_doc('di in construction', 'IFC') as di;
grant select on t_doc to authenticated;

-- A revision insert that leaves scl_revision NULL and gives the revision the
-- workflow_status whose code equals the step's — what the dialog will do.
create function pg_temp.add_rev(p_doc uuid, p_step text) returns text
  language sql as $$
  insert into dcs.revisions (document_id, project_id, step_id, status_id)
  select p_doc, t.pej_id,
         (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = p_step),
         (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = p_step)
    from t
  returning scl_revision;
$$;
-- The same with a code supplied, for the paths that may carry one.
create function pg_temp.add_rev_as(p_doc uuid, p_step text, p_code text) returns text
  language sql as $$
  insert into dcs.revisions (document_id, project_id, scl_revision, step_id, status_id)
  select p_doc, t.pej_id, p_code,
         (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = p_step),
         (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = p_step)
    from t
  returning scl_revision;
$$;
create function pg_temp.next_code(p_doc uuid, p_step text) returns text
  language sql as $$
  select dcs.next_revision_code(p_doc,
    (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = p_step));
$$;

select is((select count(*) from dcs.revisions), 0::bigint,
  'no revision exists before this file writes one');

-- ============================================================
-- 3. The series, on document d1
-- ============================================================
select is((select pg_temp.add_rev(d1, 'IDC') from t_doc), 'A',
  'GREEN: the first IDC revision, scl_revision left NULL, is A');
select is((select pg_temp.add_rev(d1, 'IDC') from t_doc), 'B', 'the next IDC revision is B');
select is((select pg_temp.add_rev(d1, 'IDC') from t_doc), 'C', 'and C — letters, one per issue');

select is((select pg_temp.add_rev(d1, 'IFR') from t_doc), '00',
  'the first IFR revision is 00 — a two-digit series that starts at zero');
select is((select pg_temp.add_rev(d1, 'IFR') from t_doc), '01', 'the next IFR revision is 01');

select is((select pg_temp.add_rev(d1, 'IFC') from t_doc), '1',
  'the first final revision (IFC) is 1');
select is((select pg_temp.add_rev(d1, 'IFI') from t_doc), '2',
  'an IFI after an IFC is 2, not a second 1 — IFC / IFI / IFB share ONE counter (brief §6.5); a counter per step would collide on UNIQUE (document_id, scl_revision)');
select is((select pg_temp.add_rev(d1, 'IFB') from t_doc), '3', 'an IFB after those is 3');
select is((select pg_temp.add_rev(d1, 'IFC') from t_doc), '4', 'and an IFC after that is 4 — the counter is shared in every direction');

select is((select pg_temp.next_code(d1, 'IDC') from t_doc), 'D',
  'IDC is still on D: the IFR and final revisions did not move the IDC series');
select is((select pg_temp.next_code(d1, 'IFR') from t_doc), '02',
  'IFR is still on 02: the IDC and final revisions did not move the IFR series');

-- Per document.
select is((select pg_temp.add_rev(d2, 'IDC') from t_doc), 'A',
  'a different document starts its own IDC series at A');
select is((select pg_temp.add_rev(d2, 'IFR') from t_doc), '00', 'and its own IFR series at 00');
select is((select pg_temp.add_rev(d2, 'IFC') from t_doc), '1', 'and its own final series at 1');

-- Step, not value: a final revision "10" is two digits, and an IFR series
-- also looks at two-digit values. Only the step says which series a row is in.
set local dcs.import_mode = 'on';
select pg_temp.add_rev_as(d2, 'IFC', '10') from t_doc;
set local dcs.import_mode = 'off';
select is((select pg_temp.next_code(d2, 'IFC') from t_doc), '11',
  'GREEN: after a carried final revision 10 the next final is 11 — the counter follows the value');
select is((select pg_temp.next_code(d2, 'IFR') from t_doc), '01',
  'and the IFR series is NOT moved by it: 01, not 11 — the counter reads the step as well as the value, because a final "10" and an IFR "10" look the same');

-- Leniency: values that do not fit their series contribute nothing.
set local dcs.import_mode = 'on';
select pg_temp.add_rev_as(d3, 'IDC', 'a') from t_doc;    -- lower case
select pg_temp.add_rev_as(d3, 'IDC', 'X1') from t_doc;   -- not a single letter
select pg_temp.add_rev_as(d3, 'IFR', '5') from t_doc;    -- one digit
select pg_temp.add_rev_as(d3, 'IFC', '01') from t_doc;   -- leading zero
select pg_temp.add_rev_as(d3, 'IFB', 'RA') from t_doc;   -- not a number at all
set local dcs.import_mode = 'off';
select is((select pg_temp.next_code(d3, 'IDC') from t_doc), 'A',
  'a carried IDC value that is not a single capital letter (a, X1) contributes nothing — the next IDC is A');
select is((select pg_temp.next_code(d3, 'IFR') from t_doc), '00',
  'a carried IFR value that is not two digits (5) contributes nothing — the next IFR is 00');
select is((select pg_temp.next_code(d3, 'IFC') from t_doc), '1',
  'a carried final value that is not a plain number (01, RA) contributes nothing — the next final is 1, and the cast never sees text');

-- A pure read.
select is((select pg_temp.next_code(d1, 'IDC') from t_doc), (select pg_temp.next_code(d1, 'IDC') from t_doc),
  'called directly it returns the same answer twice — it draws nothing, the table is the record of what was issued');
select is((select count(*) from dcs.revisions where document_id = (select d1 from t_doc)), 9::bigint,
  'and creates no row: d1 holds exactly the 9 revisions inserted above');

-- The ceilings (decision 4): raised, never widened.
select pg_temp.add_rev_as(d4, 'IDC', 'Y') from t_doc;
select is((select pg_temp.next_code(d4, 'IDC') from t_doc), 'Z', 'after Y the IDC series gives Z');
set local dcs.import_mode = 'on';
select pg_temp.add_rev_as(d4, 'IDC', 'Z') from t_doc;
select pg_temp.add_rev_as(d4, 'IFR', '99') from t_doc;
set local dcs.import_mode = 'off';
select throws_ok(
  $$select pg_temp.next_code((select d4 from t_doc), 'IDC')$$,
  '22003', null,
  'RED: past Z the IDC series raises (22003) instead of inventing AA');
select throws_ok(
  $$select pg_temp.next_code((select d4 from t_doc), 'IFR')$$,
  '22003', null,
  'RED: past 99 the IFR series raises (22003) instead of widening to three digits');

-- ============================================================
-- 4. RETCOM has no series — by decision, in both places
-- ============================================================
select throws_ok(
  $$select pg_temp.next_code((select d5 from t_doc), 'RETCOM')$$,
  '22023', null,
  'RED: next_revision_code refuses RETCOM (22023)');
select throws_like(
  $$select pg_temp.next_code((select d5 from t_doc), 'RETCOM')$$,
  '%RETCOM has no SCL revision series%deliberate, not an oversight%',
  'the error names the step and says the absence is deliberate, so the next reader does not take it for an oversight');
select throws_ok(
  $$select pg_temp.add_rev((select d5 from t_doc), 'RETCOM')$$,
  '23514', null,
  'RED: the trigger refuses an INSERT on step RETCOM (23514) even with scl_revision left NULL');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'RETCOM', 'X')$$,
  '23514', null,
  'RED: and refuses it with a code supplied, as postgres — the session-less bypass is for who may override a number, not for a step that has no series');
select is((select count(*) from dcs.revisions where step_id = (select s_retcom from t)), 0::bigint,
  'no RETCOM revision was written');
set local dcs.import_mode = 'on';
select lives_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'RETCOM', '00')$$,
  'GREEN: dcs.import_mode = ''on'' lifts the refusal — 1b.13 carries historical RETCOM rows');
select throws_ok(
  $$select pg_temp.add_rev((select d5 from t_doc), 'RETCOM')$$,
  '22023', null,
  'but the import cannot ASK for a generated RETCOM code: that still raises 22023 — it has to bring its own');
set local dcs.import_mode = 'off';

-- The other refusals of the function.
select throws_ok(
  $$select dcs.next_revision_code((select d5 from t_doc), (select st_idc from t))$$,
  '22023', null,
  'RED: a workflow_status row passed as the step is refused (22023) — the realistic mix-up, they share their codes');
select throws_ok(
  $$select dcs.next_revision_code('00000000-0000-4000-8000-000000000000', (select s_idc from t))$$,
  '22023', null,
  'RED: a document that does not exist is refused (22023)');
insert into dcs.dictionaries (dict_type, code, label) values ('workflow_step', 'XYZ', 'A step a DC added');
select throws_like(
  $$select dcs.next_revision_code((select d5 from t_doc), (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'XYZ'))$$,
  '%step XYZ has no SCL revision series%',
  'RED: a step a DC added to the dictionary has no series until someone defines one — refused by name, not guessed at');

-- ============================================================
-- 5. Who may supply a code: the project's DC at aal2, and nobody else
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);

select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'Q')$$,
  '42501', null,
  'RED: a signed-in Originator supplying scl_revision on INSERT is refused (42501 insufficient_privilege) — even a code of the right shape');
select throws_like(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'Q')$$,
  '%only by the Document Controller of this project%',
  'and the message says who may — the wording the app uses to tell it apart from the second-factor refusal');
select is(
  (select count(*) from dcs.revisions where scl_revision = 'Q'),
  0::bigint,
  'and the refused row was not written');
select is(
  (select count(*) from public.audit_log where table_name = 'dcs.revisions' and new_value ->> 'scl_revision' = 'Q'),
  0::bigint,
  'a refused INSERT leaves no audit_log row — this is a BEFORE trigger, so nothing reached the AFTER trigger');

-- The dialog's path: propose, then insert, and the two agree.
create temp table t_proposal as
  select pg_temp.next_code((select d5 from t_doc), 'IDC') as code;
select lives_ok(
  $$select pg_temp.next_code((select d5 from t_doc), 'IDC')$$,
  'GREEN: a project member may call next_revision_code as an RPC (the execute grant plus RLS)');
select is(
  (select pg_temp.add_rev((select d5 from t_doc), 'IDC')),
  (select code from t_proposal),
  'GREEN: the Originator inserts with scl_revision NULL and the stored code is the one that was proposed');

-- A non-member: sees no document, so gets no number.
select set_config('request.jwt.claims',
  json_build_object('sub', (select out_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select throws_ok(
  $$select pg_temp.next_code((select d5 from t_doc), 'IDC')$$,
  '22023', null,
  'RED: a non-member calling next_revision_code gets an error about the document, not a code — the invoker''s RLS view has no such row');
select throws_ok(
  $$select pg_temp.add_rev((select d5 from t_doc), 'IDC')$$,
  '42501', null,
  'RED: a non-member INSERTing is refused by RLS (42501) — the definer trigger computing the code does not widen who may insert');

-- The DC without the second factor. 42501 either way: the BEFORE trigger fires
-- first, and it is the only thing that stops a supplied code from a DC at aal1
-- (a DC who is also an ORIG passes the "Originators insert revisions" policy
-- without a second factor).
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'Q')$$,
  '42501', null,
  'RED: the DC at aal1 supplying scl_revision is refused (42501)');

-- A user who is both ORIG and DC, at aal1: the case only this trigger stops.
-- "Originators insert revisions" lets them insert without a second factor, so
-- no policy stands between them and a hand-typed code; the second-factor check
-- in the trigger is the only thing that does.
select set_config('request.jwt.claims',
  json_build_object('sub', (select both_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_like(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'Q')$$,
  '%verified second factor%',
  'RED: an ORIG who is also the project''s DC, at aal1, supplying scl_revision is refused (42501) with the second-factor wording — RLS lets them insert, only the trigger stops the code');
select lives_ok(
  $$select pg_temp.add_rev((select d3 from t_doc), 'IFB')$$,
  'GREEN: the same user at aal1 creates a revision with scl_revision NULL — creating one never needs the second factor');
select set_config('request.jwt.claims',
  json_build_object('sub', (select both_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is(
  (select pg_temp.add_rev_as((select d3 from t_doc), 'IFC', '9')),
  '9',
  'GREEN: and at aal2 the same user may supply one');

-- The DC at aal2.
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is(
  (select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'Q')),
  'Q',
  'GREEN: the DC at aal2 supplies scl_revision and it is stored as given — out of sequence is theirs to choose (the task''s acceptance criterion 2)');
select lives_ok(
  $$select pg_temp.add_rev((select d2 from t_doc), 'IFR')$$,
  'GREEN: the DC at aal2 also creates a revision with scl_revision NULL');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'A')$$,
  '23505', null,
  'RED: a DC-supplied code that is already used on the document is still refused by UNIQUE (23505)');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'ZZ')$$,
  '23514', null,
  'RED: a DC-supplied code that is not the shape of the step''s series is refused (23514) — two letters on IDC');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IFR', '7')$$,
  '23514', null,
  'RED: ... one digit on IFR');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IFC', '01')$$,
  '23514', null,
  'RED: ... a leading zero on a final revision');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IFC', 'A')$$,
  '23514', null,
  'RED: ... a letter on a final revision — the shape is the STEP''s, not "anything short"');
select lives_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'IFR', '05')$$,
  'GREEN: a DC-supplied IFR code of the right shape (05) is accepted');
select throws_ok(
  $$select pg_temp.add_rev_as((select d5 from t_doc), 'RETCOM', '00')$$,
  '23514', null,
  'RED: and the DC cannot supply a RETCOM revision either — no series, nothing to supply a code of');
reset role;
-- reset role does not clear the JWT claim: without this the "session-less"
-- cases below would still see the DC's auth.uid().
select set_config('request.jwt.claims', '', true);

-- The exceptions: named, and proven, so they cannot be mistaken for gaps.
select is(
  (select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'ZZ')),
  'ZZ',
  'GREEN, named: a session-less caller (postgres here; service_role and psql alike) may supply scl_revision, of any shape — the auth.uid() IS NULL bypass carried over from enforce_dc_only_numbering');
set local dcs.import_mode = 'on';
select is(
  (select pg_temp.add_rev_as((select d5 from t_doc), 'IDC', 'legacy-3')),
  'legacy-3',
  'GREEN: dcs.import_mode = ''on'' stores the supplied code verbatim, format and all — the import owns the format of what it carries');
set local dcs.import_mode = 'off';

-- ============================================================
-- 6. No revisions on a Void document
-- ============================================================
select throws_ok(
  $$select pg_temp.add_rev((select dv from t_doc), 'IDC')$$,
  '23514', null,
  'RED: a revision on a Void document is refused (23514), as postgres — there is no session-less bypass for a fact about the document');
select throws_like(
  $$select pg_temp.add_rev((select dv from t_doc), 'IDC')$$,
  '%is Void and takes no new revisions%',
  'and the message says why, and what to do instead');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok(
  $$select pg_temp.add_rev((select dv from t_doc), 'IDC')$$,
  '23514', null,
  'RED: and for the project''s Originator (23514)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*) from dcs.revisions where document_id = (select dv from t_doc)), 0::bigint,
  'no revision was written on the Void document');
set local dcs.import_mode = 'on';
select lives_ok(
  $$select pg_temp.add_rev_as((select dv from t_doc), 'IDC', 'A')$$,
  'GREEN: dcs.import_mode = ''on'' lifts it — a historical Void document arrives with the revisions it had before it was voided');
set local dcs.import_mode = 'off';
select lives_ok(
  $$select pg_temp.add_rev((select di from t_doc), 'IFC')$$,
  'GREEN: a document in any other status (IFC here) takes a revision — only VOID is refused');

select * from finish();
rollback;
