-- Tests for DCS 1b.11 (migration 1 of 2, Phase 1): manual document status
-- change by the DC, the depth-gated status guards, the two new INSERT-time
-- status guards, the one scoped admin escape in enforce_dc_only_numbering(),
-- and Void (void_reason / void_at). Migration 20260922074250.
--
-- Pattern follows final_revision_lock.test.sql and dc_only_numbering_on_insert.test.sql
-- (the newest files here): fixtures as postgres inside this transaction
-- (rolled back at the end), then impersonation via `set local role
-- authenticated` + request.jwt.claims with an explicit aal, exactly like
-- PostgREST. Every refusal is asserted by its SQLSTATE; two are also asserted
-- by exact message text (section 7), to prove the RAISE format-string fix
-- (the stray 's' from a literal '%s', which plpgsql does not treat as a
-- placeholder) actually renders clean.
--
-- Cast:
--   orig     created below   orig of PEJ (SC2602), aal1
--   dc       created below   dc of PEJ, aal2 (aal1 where a case says so)
--   dc2      created below   dc of PEJ, aal2 — a SECOND dc, distinct from the
--                            admin below, for decision 4's "DC who is not
--                            admin may not leave VOID"
--   admin    tjezionekspam@gmail.com  profiles.role = admin (seed), holds NO
--            dc role on PEJ (established by final_revision_lock.test.sql)
--   postgres                 the session-less caller (migration, psql,
--            service_role) and dcs.import_mode
--
-- SQLSTATEs: 42501 insufficient_privilege = wrong caller (not DC-at-aal2, or
-- not admin-at-aal2 on the one column that allows it). 23514 check_violation
-- = a fact about data (void_reason required or not allowed given the status;
-- INSERT status must be NOT_STARTED / must match the step). 23001
-- restrict_violation = refusing a change to something the system treats as
-- settled (void_reason/void_at once VOID; leaving VOID for a non-admin).
--
-- Section 3 (the depth gate) is the one place this file deliberately breaks
-- a trigger's own definition mid-transaction and shows its test goes red,
-- then restores it — the pattern docs/03-conventions.md asks for proof that
-- a control's ABSENCE fails, not only that its presence passes. Safe here
-- because the whole file is one transaction, rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select is(
  (select data_type from information_schema.columns
    where table_schema = 'dcs' and table_name = 'documents' and column_name = 'void_reason'),
  'text', 'dcs.documents.void_reason is text');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'dcs' and table_name = 'documents' and column_name = 'void_reason'),
  'YES', 'and nullable — required only conditionally, by the trigger, not by the column');
select is(
  (select data_type || '/' || is_nullable from information_schema.columns
    where table_schema = 'dcs' and table_name = 'documents' and column_name = 'void_at'),
  'timestamp with time zone/YES', 'dcs.documents.void_at is timestamptz, nullable');

select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and tgname = 'documents_workflow_status_dc_only'),
  'CREATE TRIGGER documents_workflow_status_dc_only BEFORE UPDATE ON dcs.documents FOR EACH ROW WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION enforce_dc_only_numbering(''admin:workflow_status_id'', ''void_reason'')',
  'documents_workflow_status_dc_only: WHEN depth = 0, admin-escape on workflow_status_id only');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_status_dc_only'),
  'CREATE TRIGGER revisions_status_dc_only BEFORE UPDATE ON dcs.revisions FOR EACH ROW WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION enforce_dc_only_numbering(''status_id'')',
  'revisions_status_dc_only: WHEN depth = 0, no admin escape');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_numbering_dc_only'),
  'CREATE TRIGGER revisions_numbering_dc_only BEFORE UPDATE ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_dc_only_numbering(''scl_revision'', ''cpy_revision'')',
  'revisions_numbering_dc_only (scl_revision / cpy_revision) is completely untouched — no WHEN clause added to it');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and tgname = 'documents_insert_status_dc_only'),
  'CREATE TRIGGER documents_insert_status_dc_only BEFORE INSERT ON dcs.documents FOR EACH ROW EXECUTE FUNCTION enforce_document_insert_status()',
  'documents_insert_status_dc_only: new function, no WHEN (no cascaded INSERT exists)');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_insert_status_dc_only'),
  'CREATE TRIGGER revisions_insert_status_dc_only BEFORE INSERT ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_revision_insert_status()',
  'revisions_insert_status_dc_only: new function, no WHEN');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and tgname = 'documents_workflow_status_void_reason'),
  'CREATE TRIGGER documents_workflow_status_void_reason BEFORE INSERT OR UPDATE ON dcs.documents FOR EACH ROW EXECUTE FUNCTION enforce_document_void()',
  'documents_workflow_status_void_reason: BEFORE INSERT OR UPDATE, no WHEN');

-- Trigger order: authorization before consistency, by name.
select is(
  (select tgname::text from pg_trigger
    where tgrelid = 'dcs.documents'::regclass and not tgisinternal
      and (tgtype & 2) = 2 and (tgtype & 16) = 16   -- BEFORE, UPDATE
      and tgname like 'documents_workflow_status%'
    order by tgname asc limit 1),
  'documents_workflow_status_dc_only',
  'on UPDATE, documents_workflow_status_dc_only (authorization) sorts before documents_workflow_status_void_reason (consistency) — name order, ''d'' < ''v''');

-- The three new functions: SECURITY INVOKER (none reads anything RLS could
-- hide from the caller), search_path pinned, EXECUTE revoked from every API
-- role (advisor 0029 does not move — trigger functions).
select ok(
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('public.enforce_document_insert_status()'::regprocedure,
                    'public.enforce_revision_insert_status()'::regprocedure,
                    'public.enforce_document_void()'::regprocedure)),
  'the three new functions are SECURITY INVOKER with search_path pinned to ''''');
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r
    cross join unnest(array['public.enforce_document_insert_status()',
                            'public.enforce_revision_insert_status()',
                            'public.enforce_document_void()']) f),
  'and no API role can execute any of them');
select ok(
  (select not prosecdef from pg_proc where oid = 'public.enforce_dc_only_numbering()'::regprocedure),
  'enforce_dc_only_numbering() is still SECURITY INVOKER — unchanged by the admin-escape diff');
select ok(
  (select bool_and(not has_function_privilege(r, 'public.enforce_dc_only_numbering()'::regprocedure, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'and no API role gained EXECUTE on it — the REVOKE is re-stated, not assumed');
select matches(
  (select prosrc from pg_proc where oid = 'public.enforce_dc_only_numbering()'::regprocedure),
  '''admin:''',
  'the body carries the admin: prefix convention — the whole change');

-- ============================================================
-- 2. Fixtures (as postgres)
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
  ('99999999-9999-4999-8999-999999999b01'::uuid, 'orig-1b11@example.com', 'Originator 1b11'),
  ('99999999-9999-4999-8999-999999999b02'::uuid, 'dc-1b11@example.com', 'DC 1b11'),
  ('99999999-9999-4999-8999-999999999b03'::uuid, 'dc2-1b11@example.com', 'DC2 1b11')
) as u(id, email, name);

create temp table t as
select
  '99999999-9999-4999-8999-999999999b01'::uuid as orig_id,
  '99999999-9999-4999-8999-999999999b02'::uuid as dc_id,
  '99999999-9999-4999-8999-999999999b03'::uuid as dc2_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,   -- SC2602, has mdr_settings from the seed
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as en_id;
grant select on t to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select pej_id, orig_id, 'orig'::dcs.project_role from t
union all
select pej_id, dc_id, 'dc'::dcs.project_role from t
union all
select pej_id, dc2_id, 'dc'::dcs.project_role from t;

-- PEJ (SC2602) has cpy_numbering = false in the seed; without this, section 6's
-- cpy_doc_number case would be answered by enforce_cpy_numbering_enabled()
-- (23514) before this task's own rule is ever reached.
update dcs.mdr_settings set cpy_numbering = true where project_id = (select pej_id from t);

select is((select count(*) from public.profiles where id = (select admin_id from t) and role = 'admin'), 1::bigint,
  'seed: the admin exists');
select is((select count(*) from dcs.project_roles where user_id = (select admin_id from t)), 0::bigint,
  'and holds no dcs.project_roles row on any project — they are an admin, not a DC (decision 4''s "not the admin who holds no dc role" case)');

create function pg_temp.status_id(p_code text) returns uuid language sql as $$
  select id from dcs.dictionaries where dict_type = 'workflow_status' and code = p_code;
$$;
create function pg_temp.step_id(p_code text) returns uuid language sql as $$
  select id from dcs.dictionaries where dict_type = 'workflow_step' and code = p_code;
$$;
create function pg_temp.doc_status(p_doc uuid) returns text language sql as $$
  select d.code from dcs.documents doc join dcs.dictionaries d on d.id = doc.workflow_status_id where doc.id = p_doc;
$$;
create function pg_temp.rev_status(p_rev uuid) returns text language sql as $$
  select s.code from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id where r.id = p_rev;
$$;
create function pg_temp.as_user(p_id uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;

-- Documents: workflow_status_id and void_reason left to the caller. Runs
-- under whatever role/claims are active — a plain SQL function, no
-- SECURITY DEFINER — so it can be called as postgres, orig, dc or admin.
create function pg_temp.add_doc(p_title text, p_status text default 'NOT_STARTED', p_void_reason text default null) returns uuid
  language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id, void_reason)
  select pej_id, p_title, ra_id, disc_id, area_id, en_id, pg_temp.status_id(p_status), p_void_reason from t
  returning id;
$$;
-- Revisions: status_id set independently of step_id, for the INSERT-guard
-- cases (add_rev below is the "correct app" shape, matching step).
create function pg_temp.add_rev_raw(p_doc uuid, p_step text, p_status text) returns uuid
  language sql as $$
  insert into dcs.revisions (document_id, project_id, step_id, status_id)
  select p_doc, pej_id, pg_temp.step_id(p_step), pg_temp.status_id(p_status) from t
  returning id;
$$;
create function pg_temp.add_rev(p_doc uuid, p_step text) returns uuid
  language sql as $$ select pg_temp.add_rev_raw(p_doc, p_step, p_step); $$;

-- ============================================================
-- 3. The depth gate — proven both directions, each with a red case
--    (decision 2). Trigger bodies are swapped mid-transaction and restored;
--    safe because this whole file rolls back at the end.
-- ============================================================
create function pg_temp.set_doc_when(p_when text) returns void language plpgsql as $$
begin
  execute 'drop trigger documents_workflow_status_dc_only on dcs.documents';
  execute format(
    $f$create trigger documents_workflow_status_dc_only before update on dcs.documents
       for each row %s execute function public.enforce_dc_only_numbering('admin:workflow_status_id', 'void_reason')$f$,
    p_when);
end $$;
create function pg_temp.set_rev_when(p_when text) returns void language plpgsql as $$
begin
  execute 'drop trigger revisions_status_dc_only on dcs.revisions';
  execute format(
    $f$create trigger revisions_status_dc_only before update on dcs.revisions
       for each row %s execute function public.enforce_dc_only_numbering('status_id')$f$,
    p_when);
end $$;

create temp table t_depth as select pg_temp.add_doc('depth d1') as d1, pg_temp.add_doc('depth d2') as d2;
grant select on t_depth to authenticated;

-- Swapping a trigger definition needs table-owner privilege, so every swap
-- below runs as postgres (the session's own role, superuser) — never while
-- `set local role authenticated` is active.

-- 3a. RED: with the WHEN clause removed entirely, promote_new_revision's own
--     cascaded UPDATEs hit the DC-only guard like any other write, and an
--     Originator can create neither a first nor a second revision.
select pg_temp.set_doc_when('');
select pg_temp.set_rev_when('');
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$select pg_temp.add_rev((select d1 from t_depth), 'IDC')$$,
  '42501', null,
  'RED (WHEN removed): an Originator cannot create the FIRST revision — promote_new_revision''s NOT_STARTED -> STARTED UPDATE now hits documents_workflow_status_dc_only');
create temp table t_depth_rev (r1 uuid);
grant all on t_depth_rev to authenticated;
select pg_temp.as_user((select dc_id from t), 'aal2');
select lives_ok(
  $$insert into t_depth_rev (r1) values (pg_temp.add_rev((select d2 from t_depth), 'IDC'))$$,
  'setup (as DC, who passes the guard even without WHEN): d2 gets its first revision so a SECOND can be attempted');
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$select pg_temp.add_rev((select d2 from t_depth), 'IFR')$$,
  '42501', null,
  'RED (WHEN removed): an Originator cannot create a SECOND revision either — the previous revision''s status_id -> SUPERSEDED UPDATE now hits revisions_status_dc_only');
reset role;
select set_config('request.jwt.claims', '', true);

-- 3b. RED: with WHEN (pg_trigger_depth() = 1) — the value first guessed and
--     wrong — a direct client write is WRONGLY let through: the guard
--     protects nothing.
select pg_temp.set_doc_when('when (pg_trigger_depth() = 1)');
select pg_temp.set_rev_when('when (pg_trigger_depth() = 1)');
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select lives_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('IFC') where id = (select d1 from t_depth)$$,
  'RED (WHEN = 1, the wrong value): the Originator''s DIRECT UPDATE of workflow_status_id WRONGLY succeeds — WHEN sees depth 0 for a direct write and 0 <> 1, so the guard never fires');
select lives_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('IFC')
     where id = (select r1 from t_depth_rev)$$,
  'RED (WHEN = 1, the wrong value): the Originator''s DIRECT UPDATE of status_id WRONGLY succeeds too');
reset role;
select set_config('request.jwt.claims', '', true);

-- 3c. GREEN: restored to the migration''s actual WHEN (pg_trigger_depth() = 0).
select pg_temp.set_doc_when('when (pg_trigger_depth() = 0)');
select pg_temp.set_rev_when('when (pg_trigger_depth() = 0)');
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('IFI') where id = (select d1 from t_depth)$$,
  '42501', null,
  'GREEN (restored): the same direct Originator UPDATE of workflow_status_id is refused again');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('IFI') where id = (select r1 from t_depth_rev)$$,
  '42501', null,
  'GREEN (restored): and of status_id');

create temp table t_depth2 as select pg_temp.add_doc('depth d3') as d1, pg_temp.add_doc('depth d4') as d2;
grant select on t_depth2 to authenticated;
create temp table t_depth2_rev (r1 uuid, r2 uuid);
grant all on t_depth2_rev to authenticated;
select lives_ok(
  $$insert into t_depth2_rev (r1) values (pg_temp.add_rev((select d1 from t_depth2), 'IDC'))$$,
  'GREEN (restored): the Originator creates a FIRST revision — the cascade to NOT_STARTED -> STARTED passes (WHEN depth 0 <> 1, guard skipped)');
select lives_ok(
  $$update t_depth2_rev set r2 = pg_temp.add_rev((select d1 from t_depth2), 'IFR')$$,
  'GREEN (restored): and a SECOND — the cascade marking the first SUPERSEDED passes too');
select is(pg_temp.rev_status((select r1 from t_depth2_rev)), 'SUPERSEDED',
  'and the FIRST revision really was marked SUPERSEDED by the cascade, not skipped entirely');
select is(pg_temp.rev_status((select r2 from t_depth2_rev)), 'IFR',
  'while the second keeps its own status — only the promoted-over revision is touched');
select is(pg_temp.doc_status((select d1 from t_depth2)), 'STARTED',
  'and the document really moved NOT_STARTED -> STARTED');
reset role;
select set_config('request.jwt.claims', '', true);

-- ============================================================
-- 4. revisions_insert_status_dc_only (decision 5, option D: status must
--    match the step — not a fixed value, not REVISION_STEP_CODES)
-- ============================================================
create temp table t_doc4 as select pg_temp.add_doc('ins-status d1') as d1, pg_temp.add_doc('ins-status d2') as d2,
  pg_temp.add_doc('ins-status d3') as d3, pg_temp.add_doc('ins-status d4') as d4,
  pg_temp.add_doc('ins-status d5') as d5, pg_temp.add_doc('ins-status d6') as d6;
grant select on t_doc4 to authenticated;

set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select lives_ok(
  $$select pg_temp.add_rev_raw((select d1 from t_doc4), 'IFR', 'IFR')$$,
  'GREEN: Originator, step IFR + status IFR (matching) — ok');
select throws_ok(
  $$select pg_temp.add_rev_raw((select d2 from t_doc4), 'IDC', 'IFC')$$,
  '42501', null,
  'RED: Originator, step IDC + status IFC (mismatched) — 42501');
select throws_ok(
  $$select pg_temp.add_rev_raw((select d3 from t_doc4), 'IDC', 'SUPERSEDED')$$,
  '42501', null,
  'RED: Originator, status SUPERSEDED outright — 42501 (SUPERSEDED is system-only, decision 1)');
select throws_ok(
  $$select pg_temp.add_rev_raw((select d4 from t_doc4), 'IDC', 'VOID')$$,
  '42501', null,
  'RED: Originator, status VOID on a revision — 42501');

select pg_temp.as_user((select dc_id from t), 'aal2');
select lives_ok(
  $$select pg_temp.add_rev_raw((select d2 from t_doc4), 'IDC', 'IFC')$$,
  'GREEN: the DC at aal2 may insert the same mismatched step/status pair the Originator was refused');

select pg_temp.as_user((select dc_id from t), 'aal1');
select throws_ok(
  $$select pg_temp.add_rev_raw((select d3 from t_doc4), 'IDC', 'IFC')$$,
  '42501', null,
  'RED: the DC without aal2 is refused on the same mismatch');

reset role;
select set_config('request.jwt.claims', '', true);
select set_config('dcs.import_mode', 'on', true);
select lives_ok(
  $$select pg_temp.add_rev_raw((select d5 from t_doc4), 'IDC', 'SUPERSEDED')$$,
  'GREEN: dcs.import_mode = ''on'' bypasses the guard entirely — a historical mismatched row arrives');
select set_config('dcs.import_mode', '', true);

-- Sanity, not a separate assertion: the guard does not restrict WHICH step a
-- non-DC caller may choose (decision 5, "noticed, not touched") — only that
-- status matches it. The one step outside REVISION_STEP_CODES (RETCOM)
-- cannot be used to show this directly: assign_scl_revision() (1b.08)
-- already refuses a RETCOM revision outright, for every caller, before this
-- guard is ever reached — d1/d2 above already cover two different steps
-- (IFR and IDC), both passing on a matching status, which is the proof.

-- ============================================================
-- 5. documents_insert_status_dc_only (decision 5)
-- ============================================================
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select lives_ok(
  $$select pg_temp.add_doc('ins d NOT_STARTED')$$,
  'GREEN: Originator, workflow_status NOT_STARTED (the only value lib/documents.ts ever sends) — ok');
select throws_ok(
  $$select pg_temp.add_doc('ins d IFC', 'IFC')$$,
  '42501', null,
  'RED: Originator, IFC at insert — 42501');
select throws_ok(
  $$select pg_temp.add_doc('ins d VOID no reason', 'VOID')$$,
  '42501', null,
  'RED: Originator, VOID at insert — 42501 (the authorization guard fires before enforce_document_void ever asks about the reason)');

select pg_temp.as_user((select dc_id from t), 'aal2');
select lives_ok(
  $$select pg_temp.add_doc('ins d VOID with reason', 'VOID', 'Superseded before it was ever started')$$,
  'GREEN: the DC at aal2 inserts a document already VOID, with a reason — passes both the authorization guard and enforce_document_void''s mandatory-reason check');
select is(pg_temp.doc_status((select id from dcs.documents where title = 'ins d VOID with reason')), 'VOID',
  'and it really is VOID');

select pg_temp.as_user((select dc_id from t), 'aal1');
select throws_ok(
  $$select pg_temp.add_doc('ins d IFC by DC aal1', 'IFC')$$,
  '42501', null,
  'RED: the DC without aal2 is refused too');

reset role;
select set_config('request.jwt.claims', '', true);
select set_config('dcs.import_mode', 'on', true);
select lives_ok(
  $$select pg_temp.add_doc('ins d import', 'IFC')$$,
  'GREEN: dcs.import_mode = ''on'' bypasses this guard too — a historical document arrives mid-workflow');
select set_config('dcs.import_mode', '', true);

-- ============================================================
-- 6. The admin escape (decision 4) — scoped to workflow_status_id only,
--    aal2 required for the admin exactly as for a DC.
-- ============================================================
create temp table t_doc6 as select pg_temp.add_doc('admin d1', 'VOID', 'to be un-voided') as voided,
  pg_temp.add_doc('admin d2') as plain;
grant select on t_doc6 to authenticated;
create temp table t_rev6 as select pg_temp.add_rev((select plain from t_doc6), 'IDC') as r1;
grant select on t_rev6 to authenticated;
update dcs.documents set cpy_doc_number = null where id in (select voided from t_doc6 union select plain from t_doc6);

set local role authenticated;
select pg_temp.as_user((select admin_id from t), 'aal2');
select lives_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('NOT_STARTED') where id = (select voided from t_doc6)$$,
  'GREEN: a non-DC admin at aal2 leaves VOID');
select is(pg_temp.doc_status((select voided from t_doc6)), 'NOT_STARTED',
  'and the status really moved');

-- Re-void as the DC (who may legitimately write both columns together) —
-- the admin cannot: the admin: escape covers workflow_status_id alone, and
-- void_reason on the same UPDATE is still DC-only, proven in this same
-- section below.
select pg_temp.as_user((select dc_id from t), 'aal2');
select lives_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('VOID'), void_reason = 'voided again for the aal1 case'
     where id = (select voided from t_doc6)$$,
  'setup (as DC): re-void the document so the admin-without-aal2 case below has something to try leaving');
select pg_temp.as_user((select admin_id from t), 'aal1');
select throws_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('NOT_STARTED') where id = (select voided from t_doc6)$$,
  '42501', null,
  'RED: the admin at aal1 (no second factor) cannot leave VOID');

select pg_temp.as_user((select dc2_id from t), 'aal2');
select throws_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('NOT_STARTED') where id = (select voided from t_doc6)$$,
  '23001', null,
  'RED: a DC at aal2 who is NOT admin cannot leave VOID (decision 4 — the escape is public.is_admin(), not any DC)');

-- The admin escape is scoped to workflow_status_id ALONE. Every other
-- guarded column still refuses the admin exactly as before this task — back
-- to the admin session (the previous case was deliberately dc2, a real DC).
select pg_temp.as_user((select admin_id from t), 'aal2');
select throws_ok(
  $$update dcs.documents set cpy_doc_number = 'ADMIN-CPY' where id = (select plain from t_doc6)$$,
  '42501', null,
  'RED: the admin cannot set cpy_doc_number (no admin: prefix on that argument)');
select throws_ok(
  $$update dcs.revisions set locked_at = now() where id = (select r1 from t_rev6)$$,
  '42501', null,
  'RED: nor locked_at');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('IFR') where id = (select r1 from t_rev6)$$,
  '42501', null,
  'RED: nor a revision''s status_id — the admin escape exists only on the documents-side trigger');
select throws_ok(
  $$update dcs.documents set void_reason = 'admin sets it alone' where id = (select plain from t_doc6)$$,
  '42501', null,
  'RED: nor void_reason by itself — it is guarded on the same trigger as workflow_status_id but carries no admin: prefix of its own');
reset role;
select set_config('request.jwt.claims', '', true);

-- ============================================================
-- 7. Exact message text — the RAISE format-string fix (no stray 's')
-- ============================================================
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('IFR') where id = (select r1 from t_rev6)$$,
  '42501',
  format('dcs.revisions.status_id may be changed only by the Document Controller of this project (dcs.project_roles role ''dc''). Caller: %s.', (select orig_id from t)),
  'the PLAIN variant renders with no stray character after the closing parenthesis');
-- The "or an admin" wording is a property of the COLUMN (workflow_status_id
-- carries the admin: prefix), not of who is calling — so any caller who
-- fails the authorization branch on it sees this text, admin included. Using
-- orig here (not admin) isolates the AUTHORIZATION message from the aal2
-- one: an admin at the wrong aal would pass authorization (is_admin() does
-- not check aal) and hit the aal2 message instead, not this one.
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('IFC') where id = (select voided from t_doc6)$$,
  '42501',
  format('dcs.documents.workflow_status_id may be changed only by the Document Controller of this project (dcs.project_roles role ''dc'') or an admin. Caller: %s.', (select orig_id from t)),
  'the ADMIN variant reads "...role ''dc'') or an admin." — not "...role ''dc'')s." (the bug found in review)');
reset role;
select set_config('request.jwt.claims', '', true);

-- ============================================================
-- 8. Void: reason mandatory, frozen, void_at trigger-owned
-- ============================================================
create temp table t_doc8 as select pg_temp.add_doc('void d1') as d1, pg_temp.add_doc('void d2') as d2,
  pg_temp.add_doc('void d3') as d3;
grant select on t_doc8 to authenticated;

set local role authenticated;
select pg_temp.as_user((select dc_id from t), 'aal2');

select throws_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('VOID') where id = (select d1 from t_doc8)$$,
  '23514', null,
  'RED: VOID with no reason at all — 23514');
select throws_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('VOID'), void_reason = '   ' where id = (select d1 from t_doc8)$$,
  '23514', null,
  'RED: VOID with a blank (whitespace-only) reason — 23514 too');

select lives_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('VOID'), void_reason = 'Client cancelled the scope'
     where id = (select d1 from t_doc8)$$,
  'GREEN: VOID with a real reason');
select isnt((select void_at from dcs.documents where id = (select d1 from t_doc8)), null,
  'and void_at was stamped by the trigger');
select ok(
  (select void_at >= now() - interval '1 minute' from dcs.documents where id = (select d1 from t_doc8)),
  'to something close to now(), not a placeholder');

-- void_at is trigger-owned: a client-supplied value on the SAME transition
-- into VOID is ignored, not stored.
update dcs.documents set workflow_status_id = pg_temp.status_id('NOT_STARTED') where id = (select d2 from t_doc8);
select lives_ok(
  $$update dcs.documents set workflow_status_id = pg_temp.status_id('VOID'), void_reason = 'client value',
       void_at = timestamptz '2000-01-01 00:00:00+00'
     where id = (select d2 from t_doc8)$$,
  'GREEN: a client-supplied void_at alongside a real transition into VOID does not raise — it is simply overwritten');
select isnt((select void_at from dcs.documents where id = (select d2 from t_doc8)), timestamptz '2000-01-01 00:00:00+00',
  'and the stored void_at is NOT the client-supplied 2000-01-01 — the trigger''s own now() won, silently');

-- Frozen while it stays VOID.
select throws_ok(
  $$update dcs.documents set void_reason = 'changed my mind' where id = (select d1 from t_doc8)$$,
  '23001', null,
  'RED: void_reason cannot be changed while the document stays VOID');
-- void_at, unlike void_reason, is not refused while staying VOID — it is
-- silently restored to its old value (the owner's decision 2: "void_at
-- restored", not refused).
select lives_ok(
  $$update dcs.documents set void_at = timestamptz '2000-01-01 00:00:00+00' where id = (select d1 from t_doc8)$$,
  'GREEN: a hand-supplied void_at while staying VOID does not raise — it is silently restored, not refused');
select isnt((select void_at from dcs.documents where id = (select d1 from t_doc8)), timestamptz '2000-01-01 00:00:00+00',
  'and the stored value is NOT the hand-supplied 2000-01-01 — the trigger kept the original');
select throws_ok(
  $$update dcs.documents set title = 'Retitled while Void', void_reason = 'sneaking a change in' where id = (select d1 from t_doc8)$$,
  '23001', null,
  'RED: a void_reason change bundled with an unrelated column edit is still refused');
select lives_ok(
  $$update dcs.documents set title = 'Retitled while Void, reason left alone' where id = (select d1 from t_doc8)$$,
  'GREEN: an ordinary column stays editable while the document is VOID — the freeze is about void_reason/void_at, not the whole row');

-- void_reason may not be set while the status is not VOID.
select throws_ok(
  $$update dcs.documents set void_reason = 'premature' where id = (select d3 from t_doc8)$$,
  '23514', null,
  'RED: setting void_reason on a document that is not VOID — 23514');

-- INSERT-side of the same rule: a non-blank void_reason with a non-VOID
-- status at INSERT is refused (checked as the DC, so only enforce_document_void
-- itself — not the authorization guard, which is INSERT-time-separate — is
-- what is on trial here).
select throws_ok(
  $$select pg_temp.add_doc('ins void_reason not void', 'NOT_STARTED', 'should not be allowed')$$,
  '23514', null,
  'RED: INSERT with void_reason set but status NOT_STARTED — 23514');

reset role;
select set_config('request.jwt.claims', '', true);

-- ============================================================
-- 9. import_mode bypasses enforce_document_void entirely
-- ============================================================
set local dcs.import_mode = 'on';
select lives_ok(
  $$select pg_temp.add_doc('import void no reason', 'VOID')$$,
  'GREEN: dcs.import_mode = ''on'' lifts the mandatory-reason rule too — a historical Void document arrives with none');
set local dcs.import_mode = 'off';
select throws_ok(
  $$select pg_temp.add_doc('import void no reason again', 'VOID')$$,
  '23514', null,
  'RED: with the setting off again, the same insert is refused — the bypass is the setting, nothing else');

select * from finish();
rollback;
