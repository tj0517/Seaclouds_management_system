-- Tests for DCS 1b.10: the files of a locked final revision (IFC / IFI / IFB)
-- are immutable, enforced in the database — dcs.revisions.locked_at and the
-- triggers revisions_assert_not_locked, revisions_locked_at_dc_only(_insert),
-- revisions_locked_at_final_step and files_assert_revision_not_locked.
-- Migration 20260921150000_lock_final_revisions.
--
-- Pattern follows revision_promotion.test.sql and storage_dcs_documents.test.sql
-- (the newest files here): fixtures as postgres inside this transaction
-- (rolled back at the end), then impersonation via `set local role
-- authenticated` + request.jwt.claims with an explicit aal. Every refusal is
-- asserted by its SQLSTATE, not by a message.
--
-- Cast:
--   orig    created below   orig of PEJ (SC2602), aal1
--   dc      created below   dc of PEJ, aal2 (aal1 where a case says so)
--   admin   tjezionekspam@gmail.com  profiles.role = admin (seed), holds NO dc role
--   postgres                the session-less caller (migration, psql, service_role)
--
-- SQLSTATEs: 23001 restrict_violation = a locked revision or its files;
--            42501 = "you may not set locked_at"; 23514 = not a final step.
--
-- What "DELETE throws" means here, and what it does not (decision (c) of the
-- task): dcs.files and dcs.revisions have a DELETE policy for the admin only
-- (FOR ALL). An Originator's or a DC's DELETE is hidden by RLS — 0 rows — and
-- never reaches the trigger. So the DELETE cases split in two and say which is
-- which: admin and postgres THROW (the trigger; red without it); orig and DC
-- delete 0 rows and the row survives (RLS; green with or without the trigger).
--
-- Not provable here, because a transaction never races itself: that a file
-- written while the DC locks the revision cannot commit inside it. The row lock
-- that does it (FOR SHARE) is asserted to be in the body.
begin;
create extension if not exists pgtap with schema extensions;
select plan(108);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select is(
  (select data_type || '/' || is_nullable from information_schema.columns
    where table_schema = 'dcs' and table_name = 'revisions' and column_name = 'locked_at'),
  'timestamp with time zone/YES',
  'dcs.revisions.locked_at is timestamptz, nullable');

select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_assert_not_locked'),
  'CREATE TRIGGER revisions_assert_not_locked BEFORE DELETE OR UPDATE ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION forbid_change_of_locked_revision()',
  'revisions_assert_not_locked is BEFORE UPDATE OR DELETE FOR EACH ROW');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_locked_at_dc_only'),
  'CREATE TRIGGER revisions_locked_at_dc_only BEFORE UPDATE ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_dc_only_numbering(''locked_at'')',
  'revisions_locked_at_dc_only reuses enforce_dc_only_numbering with locked_at (UPDATE)');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_locked_at_dc_only_insert'),
  'CREATE TRIGGER revisions_locked_at_dc_only_insert BEFORE INSERT ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_dc_only_numbering(''locked_at'')',
  'and on INSERT');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and tgname = 'revisions_locked_at_final_step'),
  'CREATE TRIGGER revisions_locked_at_final_step BEFORE INSERT OR UPDATE ON dcs.revisions FOR EACH ROW EXECUTE FUNCTION enforce_locked_at_final_step()',
  'revisions_locked_at_final_step is BEFORE INSERT OR UPDATE');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'dcs.files'::regclass and tgname = 'files_assert_revision_not_locked'),
  'CREATE TRIGGER files_assert_revision_not_locked BEFORE INSERT OR DELETE OR UPDATE ON dcs.files FOR EACH ROW EXECUTE FUNCTION forbid_change_of_locked_file()',
  'files_assert_revision_not_locked is BEFORE INSERT OR UPDATE OR DELETE on dcs.files');

select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('public.forbid_change_of_locked_revision()'::regprocedure,
                    'public.forbid_change_of_locked_file()'::regprocedure,
                    'public.enforce_locked_at_final_step()'::regprocedure)),
  'the three new functions are SECURITY DEFINER with search_path pinned to ''''');
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r
    cross join unnest(array['public.forbid_change_of_locked_revision()',
                            'public.forbid_change_of_locked_file()',
                            'public.enforce_locked_at_final_step()']) f),
  'and no API role can execute any of them — trigger functions, so advisor 0029 does not grow');
select is(
  (select tgname from pg_trigger
    where tgrelid = 'dcs.revisions'::regclass and not tgisinternal
      and (tgtype & 2) = 2 and (tgtype & 16) = 16      -- BEFORE, UPDATE
    order by tgname desc limit 1),
  'set_updated_at',
  'set_updated_at fires last among the BEFORE UPDATE triggers, so a refused write leaves no updated_at bump');
select matches(
  (select prosrc from pg_proc where oid = 'public.forbid_change_of_locked_file()'::regprocedure),
  'for share of r',
  'the file trigger locks the revision row FOR SHARE — what serialises a file write against the DC locking the revision');

select is(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%dcs-documents%'),
  5::bigint,
  'still exactly the five dcs-documents policies of 1b.09 — this task adds none');
select is(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%dcs-documents%'
      and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0::bigint,
  'and none of them is UPDATE, DELETE or ALL');

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
  ('99999999-9999-4999-8999-999999999a01'::uuid, 'orig-1b10@example.com', 'Originator 1b10'),
  ('99999999-9999-4999-8999-999999999a02'::uuid, 'dc-1b10@example.com', 'DC 1b10')
) as u(id, email, name);

create temp table t as
select
  '99999999-9999-4999-8999-999999999a01'::uuid as orig_id,
  '99999999-9999-4999-8999-999999999a02'::uuid as dc_id,
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
select pej_id, dc_id, 'dc'::dcs.project_role from t;

select is((select count(*) from public.profiles where id = (select admin_id from t) and role = 'admin'), 1::bigint,
  'seed: the admin exists and holds no dcs.project_roles row');
select is((select count(*) from dcs.project_roles where user_id = (select admin_id from t)), 0::bigint,
  'so they are not a DC of anything — decision (a): an admin without the dc role cannot set locked_at');

create function pg_temp.status_id(p_code text) returns uuid language sql as $$
  select id from dcs.dictionaries where dict_type = 'workflow_status' and code = p_code;
$$;
create function pg_temp.step_id(p_code text) returns uuid language sql as $$
  select id from dcs.dictionaries where dict_type = 'workflow_step' and code = p_code;
$$;
create function pg_temp.add_doc(p_title text) returns uuid language sql as $$
  insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
  select pej_id, p_title, ra_id, disc_id, area_id, en_id, pg_temp.status_id('NOT_STARTED') from t
  returning id;
$$;
-- The dialog's insert: code left NULL, status = the step's own code.
create function pg_temp.add_rev(p_doc uuid, p_step text) returns uuid language sql as $$
  insert into dcs.revisions (document_id, project_id, step_id, status_id)
  select p_doc, t.pej_id, pg_temp.step_id(p_step), pg_temp.status_id(p_step) from t
  returning id;
$$;
create function pg_temp.add_file(p_rev uuid, p_path text) returns uuid language sql as $$
  insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
  select p_rev, t.pej_id, split_part(p_path, '/', 4), 'original.pdf', p_path, 'original' from t
  returning id;
$$;
create function pg_temp.rev_status(p_rev uuid) returns text language sql as $$
  select s.code from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id where r.id = p_rev;
$$;
create function pg_temp.current_of(p_doc uuid) returns uuid language sql as $$
  select current_revision_id from dcs.documents where id = p_doc;
$$;
create function pg_temp.as_user(p_id uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
create function pg_temp.file_rows_deleted(p_id uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  delete from dcs.files where id = p_id;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.rev_rows_locked(p_id uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  update dcs.revisions set locked_at = now() where id = p_id;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.rev_rows_deleted(p_id uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  delete from dcs.revisions where id = p_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- One document per case. ifc / ifi / ifb: the three final steps, each locked
-- with one file. open: an IFC revision NOT locked. idc / ifr: steps that may
-- never be locked. sup / sup2: a locked IFC revision to add a revision to.
-- spare: a locked IFC revision nobody supersedes through a new revision.
-- dcl: an unlocked IFC revision the DC will lock. imp: the import case.
create temp table t_doc as
select pg_temp.add_doc('1b10 ifc') as ifc, pg_temp.add_doc('1b10 ifi') as ifi,
       pg_temp.add_doc('1b10 ifb') as ifb, pg_temp.add_doc('1b10 open') as open,
       pg_temp.add_doc('1b10 idc') as idc, pg_temp.add_doc('1b10 ifr') as ifr,
       pg_temp.add_doc('1b10 sup') as sup, pg_temp.add_doc('1b10 sup2') as sup2,
       pg_temp.add_doc('1b10 spare') as spare, pg_temp.add_doc('1b10 dcl') as dcl,
       pg_temp.add_doc('1b10 imp') as imp;
grant select on t_doc to authenticated;

create temp table t_rev as
select pg_temp.add_rev((select ifc from t_doc), 'IFC') as ifc,
       pg_temp.add_rev((select ifi from t_doc), 'IFI') as ifi,
       pg_temp.add_rev((select ifb from t_doc), 'IFB') as ifb,
       pg_temp.add_rev((select open from t_doc), 'IFC') as open,
       pg_temp.add_rev((select idc from t_doc), 'IDC') as idc,
       pg_temp.add_rev((select ifr from t_doc), 'IFR') as ifr,
       pg_temp.add_rev((select sup from t_doc), 'IFC') as sup,
       pg_temp.add_rev((select sup2 from t_doc), 'IFC') as sup2,
       pg_temp.add_rev((select spare from t_doc), 'IFC') as spare,
       pg_temp.add_rev((select dcl from t_doc), 'IFC') as dcl,
       pg_temp.add_rev((select imp from t_doc), 'IFC') as imp;
grant select on t_rev to authenticated;

create temp table t_file as
select pg_temp.add_file((select ifc from t_rev), 'SC2602/LOCK-IFC/1/f_ifc.pdf') as ifc,
       pg_temp.add_file((select ifi from t_rev), 'SC2602/LOCK-IFI/1/f_ifi.pdf') as ifi,
       pg_temp.add_file((select ifb from t_rev), 'SC2602/LOCK-IFB/1/f_ifb.pdf') as ifb,
       pg_temp.add_file((select open from t_rev), 'SC2602/LOCK-OPEN/1/f_open.pdf') as open,
       pg_temp.add_file((select imp from t_rev), 'SC2602/LOCK-IMP/1/f_imp.pdf') as imp;
grant select on t_file to authenticated;

-- Lock as postgres (session-less: passes the DC-only rule, not the step rule).
-- created_at goes back a day in the same UPDATE: "a newer revision" is judged by
-- created_at, and inside this one test transaction every now() is equal, so a
-- revision added below would not be newer than a fixture created in it. In
-- production each revision is its own transaction and the order is real.
update dcs.revisions
   set locked_at = timestamptz '2026-09-21 10:00:00+00',
       created_at = timestamptz '2026-09-20 10:00:00+00'
 where id in (select ifc from t_rev union select ifi from t_rev union select ifb from t_rev
              union select sup from t_rev union select sup2 from t_rev
              union select spare from t_rev union select imp from t_rev);

select is(
  (select count(*) from dcs.revisions where locked_at is not null and id in (select ifc from t_rev)),
  1::bigint,
  'fixture: postgres locked the IFC revision (session-less callers pass the DC-only rule)');

-- What the refused attempts below must leave untouched.
create temp table t_snap as
select r.id, to_jsonb(r) - 'status_id' - 'updated_at' as j, r.updated_at,
       (select count(*) from public.audit_log a where a.table_name = 'revisions' and a.record_id = r.id) as audit_n
  from dcs.revisions r where r.id = (select ifc from t_rev);

-- ============================================================
-- 3. dcs.files of a locked revision: UPDATE, DELETE, INSERT (criteria 1, 2)
-- ============================================================
set local role authenticated;

-- 3a. UPDATE — orig, DC (aal2) and admin, on each of IFC / IFI / IFB. All three
--     roles pass RLS for UPDATE, so what stops them is the trigger.
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifc from t_file)$$, '23001', null,
  'RED: the Originator cannot UPDATE a file of a locked IFC revision');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifi from t_file)$$, '23001', null,
  'RED: nor of a locked IFI revision');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifb from t_file)$$, '23001', null,
  'RED: nor of a locked IFB revision');

select pg_temp.as_user((select dc_id from t), 'aal2');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifc from t_file)$$, '23001', null,
  'RED: the DC at aal2 cannot UPDATE a file of a locked IFC revision');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifi from t_file)$$, '23001', null,
  'RED: nor IFI');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifb from t_file)$$, '23001', null,
  'RED: nor IFB');

select pg_temp.as_user((select admin_id from t), 'aal2');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifc from t_file)$$, '23001', null,
  'RED: the admin cannot UPDATE a file of a locked IFC revision');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifi from t_file)$$, '23001', null,
  'RED: nor IFI');
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifb from t_file)$$, '23001', null,
  'RED: nor IFB');

-- 3b. DELETE — the admin reaches the trigger and is refused; orig and DC are
--     hidden by RLS (no DELETE policy) and delete 0 rows.
select throws_ok($$delete from dcs.files where id = (select ifc from t_file)$$, '23001', null,
  'RED: the admin cannot DELETE a file of a locked IFC revision (the trigger — the admin has a DELETE policy)');
select throws_ok($$delete from dcs.files where id = (select ifi from t_file)$$, '23001', null,
  'RED: nor IFI');
select throws_ok($$delete from dcs.files where id = (select ifb from t_file)$$, '23001', null,
  'RED: nor IFB');

select pg_temp.as_user((select orig_id from t), 'aal1');
select is(
  (select array[pg_temp.file_rows_deleted(ifc), pg_temp.file_rows_deleted(ifi), pg_temp.file_rows_deleted(ifb)] from t_file),
  array[0, 0, 0]::bigint[],
  'the Originator deletes 0 rows of the three locked files — RLS (no DELETE policy), not the trigger: green with or without it');
select pg_temp.as_user((select dc_id from t), 'aal2');
select is(
  (select array[pg_temp.file_rows_deleted(ifc), pg_temp.file_rows_deleted(ifi), pg_temp.file_rows_deleted(ifb)] from t_file),
  array[0, 0, 0]::bigint[],
  'the DC at aal2 deletes 0 rows of the three locked files — likewise RLS');

-- 3c. INSERT into a locked revision (criterion 2).
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select ifc from t_rev), pej_id, 'n.pdf', 'n.pdf', 'SC2602/LOCK-IFC/1/n.pdf', 'original' from t$$,
  '23001', null,
  'RED: the Originator cannot INSERT a file into a locked IFC revision');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select ifi from t_rev), pej_id, 'n.pdf', 'n.pdf', 'SC2602/LOCK-IFI/1/n.pdf', 'original' from t$$,
  '23001', null,
  'RED: nor into a locked IFI revision');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select ifb from t_rev), pej_id, 'n.pdf', 'n.pdf', 'SC2602/LOCK-IFB/1/n.pdf', 'original' from t$$,
  '23001', null,
  'RED: nor into a locked IFB revision');
select lives_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select open from t_rev), pej_id, 'n2.pdf', 'n2.pdf', 'SC2602/LOCK-OPEN/1/n2.pdf', 'original' from t$$,
  'GREEN: the same Originator INSERTs into an unlocked IFC revision — 1b.09 upload still works');

select pg_temp.as_user((select dc_id from t), 'aal2');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select ifc from t_rev), pej_id, 'n.pdf', 'n.pdf', 'SC2602/LOCK-IFC/1/n.pdf', 'original' from t$$,
  '23001', null,
  'RED: the DC at aal2 cannot INSERT a file into a locked IFC revision');
select pg_temp.as_user((select admin_id from t), 'aal2');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select ifc from t_rev), pej_id, 'n.pdf', 'n.pdf', 'SC2602/LOCK-IFC/1/n.pdf', 'original' from t$$,
  '23001', null,
  'RED: nor the admin');

-- 3d. A file cannot be moved into a locked revision, or out of one.
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$update dcs.files set revision_id = (select ifc from t_rev) where id = (select open from t_file)$$,
  '23001', null,
  'RED: a file of an unlocked revision cannot be moved INTO a locked one (NEW.revision_id is checked)');
reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select throws_ok(
  $$update dcs.files set revision_id = (select open from t_rev) where id = (select ifc from t_file)$$,
  '23001', null,
  'RED: a file of a locked revision cannot be moved OUT of it (OLD.revision_id is checked)');

-- 3e. postgres, the session-less caller: the lock has no bypass for it.
select throws_ok($$update dcs.files set sort_order = 9 where id = (select ifc from t_file)$$, '23001', null,
  'RED: postgres cannot UPDATE a file of a locked revision — applies to every caller');
select throws_ok($$delete from dcs.files where id = (select ifc from t_file)$$, '23001', null,
  'RED: nor DELETE one');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select ifc from t_rev), pej_id, 'n.pdf', 'n.pdf', 'SC2602/LOCK-IFC/1/n.pdf', 'original' from t$$,
  '23001', null,
  'RED: nor INSERT one');

select is(
  (select count(*) from dcs.files where id in (select ifc from t_file union select ifi from t_file union select ifb from t_file)
      and sort_order = 0),
  3::bigint,
  'the three locked files are all still there, sort_order untouched');

-- ============================================================
-- 4. dcs.revisions of a locked revision (criterion 3)
-- ============================================================
set local role authenticated;

-- 4a. Any UPDATE other than status -> SUPERSEDED, whoever the caller is.
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok($$update dcs.revisions set reason_for_issue = 'edit' where id = (select ifc from t_rev)$$, '23001', null,
  'RED: the Originator cannot edit a locked revision');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('STARTED') where id = (select ifc from t_rev)$$,
  '23001', null,
  'RED: nor set its status to anything but SUPERSEDED');
select throws_ok($$update dcs.revisions set locked_at = null where id = (select ifc from t_rev)$$, '23001', null,
  'RED: nor clear locked_at — reported as locked, not as a numbering rule (revisions_assert_not_locked sorts first)');
select throws_ok(
  $$update dcs.revisions set step_id = pg_temp.step_id('IDC') where id = (select ifc from t_rev)$$,
  '23001', null,
  'RED: nor change its step');

select pg_temp.as_user((select dc_id from t), 'aal2');
select throws_ok($$update dcs.revisions set reason_for_issue = 'edit' where id = (select ifc from t_rev)$$, '23001', null,
  'RED: the DC at aal2 cannot edit a locked revision');
select throws_ok($$update dcs.revisions set locked_at = null where id = (select ifc from t_rev)$$, '23001', null,
  'RED: nor clear locked_at — decision (b): unlocking is never allowed, not even for the DC who set it');
select throws_ok(
  $$update dcs.revisions set locked_at = timestamptz '2026-12-31 00:00:00+00' where id = (select ifc from t_rev)$$,
  '23001', null,
  'RED: nor move locked_at to another time');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('SUPERSEDED'), reason_for_issue = 'edit'
     where id = (select ifc from t_rev)$$,
  '23001', null,
  'RED: SUPERSEDED plus any other change in the same UPDATE is still refused — the status is the ONLY change allowed');

select pg_temp.as_user((select admin_id from t), 'aal2');
select throws_ok($$update dcs.revisions set reason_for_issue = 'edit' where id = (select ifc from t_rev)$$, '23001', null,
  'RED: the admin cannot edit a locked revision');
select throws_ok($$update dcs.revisions set locked_at = null where id = (select ifc from t_rev)$$, '23001', null,
  'RED: nor clear locked_at');

-- 4b. DELETE: the admin is refused by the trigger, orig and DC delete 0 rows.
select throws_ok($$delete from dcs.revisions where id = (select ifc from t_rev)$$, '23001', null,
  'RED: the admin cannot DELETE a locked revision (the trigger)');
select pg_temp.as_user((select orig_id from t), 'aal1');
select is(pg_temp.rev_rows_deleted((select ifc from t_rev)), 0::bigint,
  'the Originator deletes 0 rows — RLS has no DELETE policy for them, so the trigger is never reached');
select pg_temp.as_user((select dc_id from t), 'aal2');
select is(pg_temp.rev_rows_deleted((select ifc from t_rev)), 0::bigint,
  'the DC at aal2 deletes 0 rows — likewise');

reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select throws_ok($$update dcs.revisions set locked_at = null where id = (select ifc from t_rev)$$, '23001', null,
  'RED: postgres cannot clear locked_at either — no unlock path, for anyone');
select throws_ok($$update dcs.revisions set reason_for_issue = 'edit' where id = (select ifc from t_rev)$$, '23001', null,
  'RED: nor edit the revision');
select throws_ok($$delete from dcs.revisions where id = (select ifc from t_rev)$$, '23001', null,
  'RED: nor DELETE it');
-- The cascade: deleting the document would delete its revisions.
select throws_ok($$delete from dcs.documents where id = (select ifc from t_doc)$$, '23001', null,
  'RED: nor delete its DOCUMENT — the cascade deletes the revision, which fires the trigger (Void, not delete)');
select throws_ok($$delete from public.projects where id = (select pej_id from t)$$, '23001', null,
  'RED: nor delete its PROJECT — public.projects cascades into dcs.documents, dcs.revisions and dcs.files (read from pg_constraint: all ON DELETE CASCADE), and the first locked revision stops it');

-- 4c. A refused write leaves nothing behind.
select is(
  (select to_jsonb(r) - 'status_id' - 'updated_at' from dcs.revisions r where r.id = (select id from t_snap)),
  (select j from t_snap),
  'after all of that the locked revision is byte-for-byte what it was (every column but status_id and updated_at)');
select is(pg_temp.rev_status((select id from t_snap)), 'IFC', 'its status is still IFC');
select is((select updated_at from dcs.revisions where id = (select id from t_snap)), (select updated_at from t_snap),
  'updated_at was not bumped — the lock trigger fires before set_updated_at');
select is(
  (select count(*) from public.audit_log a where a.table_name = 'revisions' and a.record_id = (select id from t_snap)),
  (select audit_n from t_snap),
  'and no audit_log row was written for any refused attempt');

-- 4d. The one change a locked revision takes: a new revision supersedes it.
--     Originator first (criterion 3), then the DC.
create temp table t_snap2 as
select r.id, to_jsonb(r) - 'status_id' - 'updated_at' as j
  from dcs.revisions r where r.id in (select sup from t_rev union select sup2 from t_rev);
grant select on t_snap2 to authenticated;

set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
create temp table t_new (sup uuid, sup2 uuid);
grant all on t_new to authenticated;
select lives_ok(
  $$insert into t_new (sup) values (pg_temp.add_rev((select sup from t_doc), 'IFC'))$$,
  'GREEN: the Originator adds a revision to a document whose current revision is locked — promote_new_revision() still succeeds');
select is(pg_temp.rev_status((select sup from t_rev)), 'SUPERSEDED',
  'GREEN: and the locked revision ends up SUPERSEDED');
select is(pg_temp.current_of((select sup from t_doc)), (select sup from t_new),
  'the new revision is the document''s current one');
select is(pg_temp.rev_status((select sup from t_new)), 'IFC',
  'and it keeps its own status — only the previous current revision is touched');

select pg_temp.as_user((select dc_id from t), 'aal2');
select lives_ok(
  $$update t_new set sup2 = pg_temp.add_rev((select sup2 from t_doc), 'IFC')$$,
  'GREEN: the DC at aal2 adds a revision on another document with a locked current revision');
select is(pg_temp.rev_status((select sup2 from t_rev)), 'SUPERSEDED',
  'and that locked revision is SUPERSEDED too');

reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select is(
  (select array_agg(r.locked_at order by r.id) from dcs.revisions r where r.id in (select sup from t_rev union select sup2 from t_rev)),
  (select array_agg(timestamptz '2026-09-21 10:00:00+00' order by x) from (select sup as x from t_rev union select sup2 from t_rev) q),
  'both superseded revisions are still locked — SUPERSEDED changed the status and nothing else');
select is(
  (select count(*) from dcs.revisions r join t_snap2 s on s.id = r.id where to_jsonb(r) - 'status_id' - 'updated_at' = s.j),
  2::bigint,
  'and every other column of both is exactly as it was');
select is((select locked_at from dcs.revisions where id = (select sup from t_new)), null,
  'the new revisions are NOT locked — a lock is never inherited');
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('SUPERSEDED') where id = (select sup from t_rev)$$,
  '23001', null,
  'RED: a locked revision that is already SUPERSEDED takes no further UPDATE — not even the same status again, though a newer revision exists');
reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user

-- SUPERSEDED by hand is refused unless a NEWER revision of the document exists
-- (the manual-SUPERSEDED gap, closed in review of 1b.10). spare is a locked
-- revision with no newer one. Red without the `exists (... created_at >)`
-- condition in forbid_change_of_locked_revision(): the bare status change passes.
set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('SUPERSEDED') where id = (select spare from t_rev)$$,
  '23001', null,
  'RED: an Originator cannot mark a locked revision SUPERSEDED by hand when the document has no newer revision');
select pg_temp.as_user((select admin_id from t), 'aal2');
select throws_ok(
  $$update dcs.revisions set status_id = pg_temp.status_id('SUPERSEDED') where id = (select spare from t_rev)$$,
  '23001', null,
  'RED: nor the admin');
select is(pg_temp.rev_status((select spare from t_rev)), 'IFC',
  'and the revision is still IFC — the refused UPDATE changed nothing');
-- An OLDER revision does not count as "newer": adding one whose created_at is
-- earlier than the locked revision's is refused, because promote_new_revision()
-- would have to mark the locked one SUPERSEDED for an older one. (As postgres,
-- session-less. In practice created_at is the column default and never older;
-- only an explicit value can do this.)
reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, step_id, status_id, created_at)
    select (select spare from t_doc), pej_id, pg_temp.step_id('IDC'), pg_temp.status_id('IDC'),
           timestamptz '2026-09-01 10:00:00+00' from t$$,
  '23001', null,
  'RED: a revision OLDER than the locked one cannot replace it — the promotion UPDATE is refused, so the INSERT is');
select is((select count(*) from dcs.revisions where document_id = (select spare from t_doc)), 1::bigint,
  'and nothing was written: the document still has just its locked revision');
select is(pg_temp.rev_status((select spare from t_rev)), 'IFC',
  'which is still IFC');

-- ============================================================
-- 5. locked_at: only on a final step (criterion 4), only by the DC at aal2 (a)
-- ============================================================
set local role authenticated;
select pg_temp.as_user((select dc_id from t), 'aal2');
select throws_ok($$update dcs.revisions set locked_at = now() where id = (select idc from t_rev)$$, '23514', null,
  'RED: setting locked_at on an IDC revision is refused (23514), even for the DC at aal2');
select throws_ok($$update dcs.revisions set locked_at = now() where id = (select ifr from t_rev)$$, '23514', null,
  'RED: and on an IFR revision');
reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select throws_ok($$update dcs.revisions set locked_at = now() where id = (select idc from t_rev)$$, '23514', null,
  'RED: postgres too — the step rule has no session-less bypass');
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, step_id, status_id, locked_at)
    select (select idc from t_doc), pej_id, pg_temp.step_id('IDC'), pg_temp.status_id('IDC'), now() from t$$,
  '23514', null,
  'RED: nor can a revision be INSERTed already locked on an IDC step');
select lives_ok(
  $$insert into dcs.revisions (document_id, project_id, step_id, status_id, locked_at)
    select (select idc from t_doc), pej_id, pg_temp.step_id('IFB'), pg_temp.status_id('IFB'), now() from t$$,
  'GREEN: postgres INSERTs a revision already locked on a final step (historical rows arrive this way)');

set local role authenticated;
select pg_temp.as_user((select orig_id from t), 'aal1');
select lives_ok($$update dcs.revisions set reason_for_issue = 'edit' where id = (select dcl from t_rev)$$,
  'GREEN: an unlocked IFC revision is still editable by its Originator');
select throws_ok($$update dcs.revisions set locked_at = now() where id = (select dcl from t_rev)$$, '42501', null,
  'RED: the Originator cannot set locked_at (42501) although "Originators update revisions" lets them UPDATE the row');
select throws_ok(
  $$insert into dcs.revisions (document_id, project_id, step_id, status_id, locked_at)
    select (select open from t_doc), pej_id, pg_temp.step_id('IFC'), pg_temp.status_id('IFC'), now() from t$$,
  '42501', null,
  'RED: nor INSERT a revision already locked (42501)');
select pg_temp.as_user((select admin_id from t), 'aal2');
select throws_ok($$update dcs.revisions set locked_at = now() where id = (select dcl from t_rev)$$, '42501', null,
  'RED: the admin, who holds no dc role, cannot set locked_at (42501) — decision (a)');
select pg_temp.as_user((select dc_id from t), 'aal1');
select is(
  pg_temp.rev_rows_locked((select dcl from t_rev)),
  0::bigint,
  'the DC at aal1 updates 0 rows — RLS: "Doc controllers update revisions" needs aal2, so the row is invisible to them and no trigger runs (42501 from the trigger itself is what a user holding BOTH orig and dc gets at aal1)');
select pg_temp.as_user((select dc_id from t), 'aal2');
select lives_ok($$update dcs.revisions set locked_at = now() where id = (select dcl from t_rev)$$,
  'GREEN: the DC of the project at aal2 locks an IFC revision');
select pg_temp.as_user((select orig_id from t), 'aal1');
select throws_ok($$update dcs.revisions set reason_for_issue = 'edit again' where id = (select dcl from t_rev)$$, '23001', null,
  'RED: and from that moment the Originator cannot edit it');
reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select isnt((select locked_at from dcs.revisions where id = (select dcl from t_rev)), null,
  'the DC''s lock is on the row');

-- ============================================================
-- 6. dcs.import_mode (criterion 5) — INSERT and UPDATE pass, DELETE does not
-- ============================================================
select set_config('dcs.import_mode', 'on', true);
select lives_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select imp from t_rev), pej_id, 'i2.pdf', 'i2.pdf', 'SC2602/LOCK-IMP/1/i2.pdf', 'original' from t$$,
  'GREEN: with dcs.import_mode = on a file INSERT into a locked revision passes');
select lives_ok($$update dcs.files set sort_order = 5 where id = (select imp from t_file)$$,
  'GREEN: and so does a file UPDATE');
select lives_ok($$update dcs.revisions set reason_for_issue = 'historical' where id = (select imp from t_rev)$$,
  'GREEN: and an UPDATE of the locked revision itself');
select throws_ok($$delete from dcs.files where id = (select imp from t_file)$$, '23001', null,
  'RED: but DELETE of a file is still refused under import_mode');
select throws_ok($$delete from dcs.revisions where id = (select imp from t_rev)$$, '23001', null,
  'RED: and so is DELETE of the locked revision');
select throws_ok($$update dcs.revisions set locked_at = now() where id = (select ifr from t_rev)$$, '23514', null,
  'RED: import_mode does not lift the locked_at -> final-step rule: a fact about the row');
select set_config('dcs.import_mode', '', true);
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select imp from t_rev), pej_id, 'i3.pdf', 'i3.pdf', 'SC2602/LOCK-IMP/1/i3.pdf', 'original' from t$$,
  '23001', null,
  'RED: with the setting off again the same INSERT is refused — the bypass is the setting, nothing else');

-- ============================================================
-- 7. Storage (criterion 6): no policy, so UPDATE and DELETE of an object under a
--    locked revision's path are refused — 0 rows, as in storage_dcs_documents §7.
--    Not red without the triggers: this proves the ABSENCE of a policy, and the
--    section 1 assertions pin that this task added none.
-- ============================================================
insert into storage.objects (bucket_id, name)
select 'dcs-documents', f.storage_path
  from dcs.files f
 where f.id in (select ifc from t_file union select ifi from t_file union select ifb from t_file);

create function pg_temp.objs_updated(p_names text[]) returns bigint[] language plpgsql as $$
declare n bigint; res bigint[] := '{}'; nm text;
begin
  foreach nm in array p_names loop
    update storage.objects set name = nm || '.renamed' where bucket_id = 'dcs-documents' and name = nm;
    get diagnostics n = row_count;
    res := res || n;
  end loop;
  return res;
end $$;
create function pg_temp.objs_deleted(p_names text[]) returns bigint[] language plpgsql as $$
declare n bigint; res bigint[] := '{}'; nm text;
begin
  foreach nm in array p_names loop
    delete from storage.objects where bucket_id = 'dcs-documents' and name = nm;
    get diagnostics n = row_count;
    res := res || n;
  end loop;
  return res;
end $$;
create temp table t_obj as
  select array_agg(f.storage_path order by f.storage_path) as names
    from dcs.files f
   where f.id in (select ifc from t_file union select ifi from t_file union select ifb from t_file);
grant select on t_obj to authenticated;

set local role authenticated;
set local storage.allow_delete_query = 'true';
select pg_temp.as_user((select orig_id from t), 'aal1');
select is((select count(*) from storage.objects where name like 'SC2602/LOCK-%'), 3::bigint,
  'the Originator SEES the three objects, so a 0 below is the missing UPDATE / DELETE policy, not invisibility');
select is(pg_temp.objs_updated((select names from t_obj)), array[0, 0, 0]::bigint[],
  'RED: the Originator UPDATEs 0 objects under the locked revisions'' paths — no overwrite, no upsert');
select is(pg_temp.objs_deleted((select names from t_obj)), array[0, 0, 0]::bigint[],
  'RED: and DELETEs 0');
select pg_temp.as_user((select dc_id from t), 'aal2');
select is(pg_temp.objs_updated((select names from t_obj)), array[0, 0, 0]::bigint[],
  'RED: the DC at aal2 UPDATEs 0 objects');
select is(pg_temp.objs_deleted((select names from t_obj)), array[0, 0, 0]::bigint[],
  'RED: and DELETEs 0');
select pg_temp.as_user((select admin_id from t), 'aal2');
select is(pg_temp.objs_updated((select names from t_obj)), array[0, 0, 0]::bigint[],
  'RED: the admin UPDATEs 0 objects');
select is(pg_temp.objs_deleted((select names from t_obj)), array[0, 0, 0]::bigint[],
  'RED: and DELETEs 0 — not even the admin');
reset role;
select set_config('request.jwt.claims', '', true);   -- session-less: no claims left over from the last as_user
select is((select count(*) from storage.objects where name like 'SC2602/LOCK-%' and name not like '%.renamed'), 3::bigint,
  'postgres: all three objects are still there under their own names');
select is((select count(*) from storage.objects where name like '%.renamed'), 0::bigint,
  'and none was renamed');

select * from finish();
rollback;
