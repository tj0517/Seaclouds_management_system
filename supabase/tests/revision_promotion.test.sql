-- Tests for DCS 1b.08: a new revision becomes the document's current one —
-- trigger revisions_promote_current (public.promote_new_revision()) and the
-- SUPERSEDED workflow status.
-- Migrations 20260920134648_workflow_status_superseded and
-- 20260920134800_revisions_promote_current.
--
-- The generator half (scl_revision, RETCOM, Void) is
-- scl_revision_generator.test.sql; here every revision is inserted the way the
-- New Revision dialog will insert one — scl_revision left NULL, status_id the
-- workflow_status whose code equals the step's — and the question is what the
-- database does about the DOCUMENT and the PREVIOUS revision afterwards.
--
-- Pattern follows scl_revision_generator.test.sql: fixtures as postgres inside
-- this transaction (rolled back at the end), then impersonation via
-- `set local role authenticated` + request.jwt.claims with an explicit aal.
--
-- Not provable here, because a transaction never races itself: that two
-- revisions inserted at once on one document are applied in order. The row lock
-- that does it is asserted to be in the body; the concurrent proof is parallel
-- psql sessions run by hand, reported in the PR.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- ============================================================
-- 1. Shape (red without the migrations)
-- ============================================================
select is(
  (select count(*) from dcs.dictionaries where dict_type = 'workflow_status' and code = 'SUPERSEDED' and is_active),
  1::bigint,
  'workflow_status has an active SUPERSEDED row');
select cmp_ok(
  (select sort_order from dcs.dictionaries where dict_type = 'workflow_status' and code = 'SUPERSEDED'),
  '>',
  (select sort_order from dcs.dictionaries where dict_type = 'workflow_status' and code = 'VOID'),
  'and it sorts after VOID, the last of the nine document states');

select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_promote_current'),
  'CREATE TRIGGER revisions_promote_current AFTER INSERT ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION promote_new_revision()',
  'revisions_promote_current is AFTER INSERT FOR EACH ROW — after, so the composite foreign key sees the row it points at');
select is(
  (select tgname from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and not tgisinternal
      and (tgtype & 2) = 0 and (tgtype & 4) = 4   -- AFTER, INSERT
    order by tgname limit 1),
  'audit_revisions',
  'audit_revisions fires before it, so the audit log reads: the insert, then the supersede and the document update it caused');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.promote_new_revision()'::regprocedure),
  'the function is SECURITY DEFINER with search_path pinned to ''''');
select ok(
  (select bool_and(not has_function_privilege(r, 'public.promote_new_revision()', 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'and no API role can execute it — a trigger function, so advisor 0029 stays at 12');
select matches(
  (select prosrc from pg_proc where oid = 'public.promote_new_revision()'::regprocedure),
  'for no key update;',
  'the body locks the document row first, FOR NO KEY UPDATE — what serialises two revisions on one document; FOR UPDATE would deadlock against the foreign-key check''s key share (measured, see the migration)');
select doesnt_match(
  (select prosrc from pg_proc where oid = 'public.promote_new_revision()'::regprocedure),
  'for\s+update',
  'and it is not the plain FOR UPDATE, which two concurrent revisions on one document turn into a deadlock');

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
  ('99999999-9999-4999-8999-999999999991'::uuid, 'orig-1b08p@example.com', 'Originator 1b08p'),
  ('99999999-9999-4999-8999-999999999992'::uuid, 'dc-1b08p@example.com', 'DC 1b08p')
) as u(id, email, name);

create temp table t as
select
  '99999999-9999-4999-8999-999999999991'::uuid as orig_id,
  '99999999-9999-4999-8999-999999999992'::uuid as dc_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,   -- SC2602, has mdr_settings from the seed
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as en_id;
grant select on t to authenticated;

insert into dcs.project_roles (project_id, user_id, role)
select pej_id, orig_id, 'orig'::dcs.project_role from t
union all
select pej_id, dc_id, 'dc'::dcs.project_role from t;

create function pg_temp.status_id(p_code text) returns uuid language sql as $$
  select id from dcs.dictionaries where dict_type = 'workflow_status' and code = p_code;
$$;
create function pg_temp.add_doc(p_title text, p_status text default 'NOT_STARTED') returns uuid
  language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
  select pej_id, p_title, ra_id, disc_id, area_id, en_id, pg_temp.status_id(p_status) from t
  returning id;
$$;
-- p1 the main ladder, p2 a document already in IFC, p3 the missing-SUPERSEDED
-- case, p4 the missing-STARTED case, p5 a multi-row insert, p6 the DC's.
create temp table t_doc as
select pg_temp.add_doc('p1 ladder') as p1,
       pg_temp.add_doc('p2 already in construction', 'IFC') as p2,
       pg_temp.add_doc('p3 missing SUPERSEDED') as p3,
       pg_temp.add_doc('p4 missing STARTED') as p4,
       pg_temp.add_doc('p5 multi-row') as p5,
       pg_temp.add_doc('p6 DC') as p6;
grant select on t_doc to authenticated;

-- The dialog's insert: code left NULL, status = the step's own code.
create function pg_temp.add_rev(p_doc uuid, p_step text, p_date date default null) returns uuid
  language sql as $$
  insert into dcs.revisions (document_id, project_id, step_id, status_id, revision_date)
  select p_doc, t.pej_id,
         (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = p_step),
         pg_temp.status_id(p_step), p_date
    from t
  returning id;
$$;
create function pg_temp.current_of(p_doc uuid) returns uuid language sql as $$
  select current_revision_id from dcs.documents where id = p_doc;
$$;
create function pg_temp.doc_status(p_doc uuid) returns text language sql as $$
  select s.code from dcs.documents d join dcs.dictionaries s on s.id = d.workflow_status_id where d.id = p_doc;
$$;
create function pg_temp.rev_status(p_rev uuid) returns text language sql as $$
  select s.code from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id where r.id = p_rev;
$$;

-- ============================================================
-- 3. A dictionary row the system needs is missing: named error, no half-write.
--    Done first, while no document is STARTED and no revision is SUPERSEDED,
--    so the rows are unreferenced and can be deleted and put back with their
--    own ids (dictionary codes are immutable, so they cannot be renamed).
-- ============================================================
create temp table t_saved as
  select * from dcs.dictionaries
   where dict_type = 'workflow_status' and code in ('STARTED', 'SUPERSEDED');

delete from dcs.dictionaries where dict_type = 'workflow_status' and code = 'STARTED';
select throws_like(
  $$select pg_temp.add_rev((select p4 from t_doc), 'IDC')$$,
  '%workflow_status STARTED is missing%',
  'RED: with the STARTED row gone, the first revision on a NOT_STARTED document is refused by name — not left half-done');
select is(pg_temp.doc_status((select p4 from t_doc)), 'NOT_STARTED',
  'and the document is still NOT_STARTED');
select is((select count(*) from dcs.revisions where document_id = (select p4 from t_doc)), 0::bigint,
  'and the revision was not written — the whole INSERT rolled back with the trigger''s error');
insert into dcs.dictionaries select * from t_saved where code = 'STARTED';

select lives_ok(
  $$select pg_temp.add_rev((select p3 from t_doc), 'IDC')$$,
  'p3''s first revision (nothing to supersede) is written');
delete from dcs.dictionaries where dict_type = 'workflow_status' and code = 'SUPERSEDED';
select throws_like(
  $$select pg_temp.add_rev((select p3 from t_doc), 'IFR')$$,
  '%workflow_status SUPERSEDED is missing%',
  'RED: with the SUPERSEDED row gone, a second revision is refused by name — the alternative is a document with two live revisions');
select is((select count(*) from dcs.revisions where document_id = (select p3 from t_doc)), 1::bigint,
  'and the second revision was not written');
insert into dcs.dictionaries select * from t_saved where code = 'SUPERSEDED';

-- ============================================================
-- 4. The ladder on p1, as the project's Originator at aal1
-- ============================================================
select is(pg_temp.current_of((select p1 from t_doc)), null,
  'before: p1 has no current revision');
select is(pg_temp.doc_status((select p1 from t_doc)), 'NOT_STARTED', 'and is NOT_STARTED');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t), 'role', 'authenticated', 'aal', 'aal1')::text, true);

create temp table t_rev (n int, id uuid);
grant all on t_rev to authenticated;
insert into t_rev select 1, pg_temp.add_rev((select p1 from t_doc), 'IDC', date '2026-09-01');

select is(pg_temp.current_of((select p1 from t_doc)), (select id from t_rev where n = 1),
  'GREEN: the first revision becomes the document''s current revision');
select is(pg_temp.doc_status((select p1 from t_doc)), 'STARTED',
  'GREEN: and the document moves NOT_STARTED -> STARTED');
select is(pg_temp.rev_status((select id from t_rev where n = 1)), 'IDC',
  'the new revision keeps the status it was inserted with (the step''s own code) — choosing it is the dialog''s job');
select is(
  (select count(*) from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id
    where r.document_id = (select p1 from t_doc) and s.code = 'SUPERSEDED'),
  0::bigint,
  'with nothing before it, nothing is superseded');

-- v_mdr follows with no change to the view (acceptance criterion 6).
select is(
  (select scl_revision from dcs.v_mdr where document_id = (select p1 from t_doc)), 'A',
  'v_mdr shows the current revision code (A) with no change to the view');
select is(
  (select issue_date from dcs.v_mdr where document_id = (select p1 from t_doc)), date '2026-09-01',
  'and its date as issue_date');
select is(
  (select workflow_status_code from dcs.v_mdr where document_id = (select p1 from t_doc)), 'STARTED',
  'and the document status STARTED');

insert into t_rev select 2, pg_temp.add_rev((select p1 from t_doc), 'IFR', date '2026-09-10');
select is(pg_temp.current_of((select p1 from t_doc)), (select id from t_rev where n = 2),
  'GREEN: the second revision replaces the first as current');
select is(pg_temp.rev_status((select id from t_rev where n = 1)), 'SUPERSEDED',
  'GREEN: and the first revision is marked SUPERSEDED');
select is(pg_temp.rev_status((select id from t_rev where n = 2)), 'IFR',
  'while the new one keeps its own status');
select is(pg_temp.doc_status((select p1 from t_doc)), 'STARTED',
  'the document status is not touched again: only NOT_STARTED moves');
select is(
  (select scl_revision from dcs.v_mdr where document_id = (select p1 from t_doc)), '00',
  'v_mdr now shows the IFR code 00');
select is(
  (select issue_date from dcs.v_mdr where document_id = (select p1 from t_doc)), date '2026-09-10',
  'and the new date');

insert into t_rev select 3, pg_temp.add_rev((select p1 from t_doc), 'IFC', date '2026-09-20');
select is(pg_temp.current_of((select p1 from t_doc)), (select id from t_rev where n = 3),
  'a third revision becomes current');
select is(
  (select array_agg(pg_temp.rev_status(id) order by n) from t_rev where n <= 3),
  array['SUPERSEDED', 'SUPERSEDED', 'IFC'],
  'GREEN: the first stays SUPERSEDED, the second becomes SUPERSEDED, the third keeps IFC — only the previous current one is ever touched');
select is(
  (select count(*) from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id
    where r.document_id = (select p1 from t_doc) and s.code <> 'SUPERSEDED'),
  1::bigint,
  'exactly one revision of the document is not SUPERSEDED — and it is the current one');
select is(pg_temp.doc_status((select p1 from t_doc)), 'STARTED',
  'the document is still STARTED: an IFC revision does not change the document status — manual status changes are 1b.11');

-- A document already past NOT_STARTED keeps its status.
insert into t_rev select 4, pg_temp.add_rev((select p2 from t_doc), 'IFR');
select is(pg_temp.doc_status((select p2 from t_doc)), 'IFC',
  'GREEN: a document already in IFC keeps IFC when it gets a revision — only NOT_STARTED is moved, never another status');
select is(pg_temp.current_of((select p2 from t_doc)), (select id from t_rev where n = 4),
  'but its current revision is still set');

-- Several rows in one statement: each becomes current in turn.
create temp table t_multi as
  with ins as (
    insert into dcs.revisions (document_id, project_id, step_id, status_id)
    select (select p5 from t_doc), (select pej_id from t),
           (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC'),
           pg_temp.status_id('IDC')
      from generate_series(1, 3)
    returning id, scl_revision
  ) select * from ins;
select is(
  (select array_agg(scl_revision order by scl_revision) from t_multi),
  array['A', 'B', 'C'],
  'a multi-row INSERT numbers its rows A, B, C — each row''s trigger sees the ones before it');
select is(
  pg_temp.rev_status((select id from t_multi where scl_revision = 'C')), 'IDC',
  'and the last row is the live one');
select is(
  (select count(*) from t_multi m where pg_temp.rev_status(m.id) = 'SUPERSEDED'), 2::bigint,
  'the two before it are SUPERSEDED');
select is(
  pg_temp.current_of((select p5 from t_doc)), (select id from t_multi where scl_revision = 'C'),
  'and the document points at C');

-- ============================================================
-- 5. The audit trail: every write the trigger makes is attributed to the
--    signed-in user, because audit_trigger() reads auth.uid()
-- ============================================================
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.revisions' and action = 'UPDATE' and field_name = 'status_id'
      and record_id = (select id from t_rev where n = 1)
      and old_value = to_jsonb((select pg_temp.status_id('IDC')))
      and new_value = to_jsonb((select pg_temp.status_id('SUPERSEDED')))
      and user_id = (select orig_id from t)
      and project_id = (select pej_id from t)),
  1::bigint,
  'the supersede is in the audit log: the first revision, IDC -> SUPERSEDED, by the Originator, scoped to the project');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and action = 'UPDATE' and field_name = 'current_revision_id'
      and record_id = (select p1 from t_doc)
      and new_value = to_jsonb((select id from t_rev where n = 1))
      and user_id = (select orig_id from t)),
  1::bigint,
  'the document''s current_revision_id change is in it, by the Originator');
select is(
  (select count(*) from public.audit_log
    where table_name = 'dcs.documents' and action = 'UPDATE' and field_name = 'workflow_status_id'
      and record_id = (select p1 from t_doc)
      and old_value = to_jsonb((select pg_temp.status_id('NOT_STARTED')))
      and new_value = to_jsonb((select pg_temp.status_id('STARTED')))
      and user_id = (select orig_id from t)),
  1::bigint,
  'and so is NOT_STARTED -> STARTED — one UPDATE, so both document changes come from a single audited write');

-- ============================================================
-- 6. The DC, at aal2, on a fresh document
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select dc_id from t), 'role', 'authenticated', 'aal', 'aal2')::text, true);
insert into t_rev select 5, pg_temp.add_rev((select p6 from t_doc), 'IDC');
insert into t_rev select 6, pg_temp.add_rev((select p6 from t_doc), 'IFR');
select is(pg_temp.current_of((select p6 from t_doc)), (select id from t_rev where n = 6),
  'GREEN: the DC at aal2 gets the same result — the second revision is current');
select is(pg_temp.rev_status((select id from t_rev where n = 5)), 'SUPERSEDED',
  'and the first is SUPERSEDED');
reset role;
select set_config('request.jwt.claims', '', true);

-- ============================================================
-- 7. What a refused revision leaves behind: nothing
-- ============================================================
select throws_ok(
  $$select pg_temp.add_rev((select p1 from t_doc), 'RETCOM')$$,
  '23514', null,
  'RED: a RETCOM revision (refused by the generator half) does not move the document either...');
select is(pg_temp.current_of((select p1 from t_doc)), (select id from t_rev where n = 3),
  '...its current revision is still the third...');
select is(pg_temp.rev_status((select id from t_rev where n = 3)), 'IFC',
  '...and the third revision is still IFC, not SUPERSEDED');

select * from finish();
rollback;
