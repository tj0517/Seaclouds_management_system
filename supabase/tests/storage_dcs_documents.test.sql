-- Tests for DCS 1b.09, PR 1 of 2: bucket dcs-documents, the storage.objects
-- policies for it, and NOT NULL on dcs.files.file_name / original_name /
-- storage_path.
-- Migrations 20260921112840_create_dcs_documents_bucket and
-- 20260921112841_files_paths_not_null.
--
-- Pattern follows revision_promotion.test.sql (the newest file here): fixtures
-- as postgres inside this transaction (rolled back at the end), then
-- impersonation via `set local role authenticated` + request.jwt.claims with
-- an explicit aal, exactly like PostgREST — and exactly like the storage-api,
-- which runs its INSERT into storage.objects as the caller's JWT. So "403" in
-- this file means what 1b.09 says it means: 0 rows on a SELECT under RLS, and
-- 42501 on an INSERT.
--
-- SELECT is narrower than dcs.files (O-16, decided on PR #80): bytes go to
-- holders of a dcs.project_roles row on the project (any of the six roles)
-- and to admins; a Timesheet project_assignments row alone reads nothing
-- here, while it still reads dcs.files metadata.
--
-- Every "this user sees" assertion is a bare count(*) over storage.objects
-- with no WHERE (docs/03-conventions.md): the difference between users has to
-- be made by the database. The file therefore expects a database from
-- `supabase db reset` — storage.objects empty — and asserts that first.
--
-- Cast:
--   admin      tjezionekspam@gmail.com   profiles.role = admin (seed)
--   ernest     ejezionek@gmail.com       TES member of PEJ via project_assignments,
--                                        no DCS role (seed) — the O-16 case: 0 objects
--   tymon      tjezionek2000@gmail.com   TES member of IT only (seed)
--   orig_pej   created below             orig of PEJ
--   dc_pej     created below             dc of PEJ
--   view_pej   created below             view of PEJ — a DCS role that writes nothing
--   orig_it    created below             orig of IT — an Originator, of the wrong project
--   outsider   created below             nothing anywhere
--
-- Seed projects (fixed UUIDs): PEJ = 6c0909ce-… (SC2602, has mdr_settings),
-- IT = 094e130b-… (SCMS-IT). Object keys start with the project_code.
--
-- Not provable here: the size limit (enforced by the storage-api, not by
-- Postgres) and the signed-URL path (PR 2, browser).
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- ============================================================
-- 1. Bucket (red without the migration)
-- ============================================================
select is(
  (select count(*) from storage.buckets where id = 'dcs-documents'), 1::bigint,
  'bucket dcs-documents exists');
select is(
  (select public from storage.buckets where id = 'dcs-documents'), false,
  'and it is private');
select is(
  (select file_size_limit from storage.buckets where id = 'dcs-documents'), 104857600::bigint,
  'file_size_limit is 104857600 (100 MiB)');
select is(
  (select allowed_mime_types from storage.buckets where id = 'dcs-documents'), null::text[],
  'allowed_mime_types is NULL — any type');

-- ============================================================
-- 2. Policies: exactly five for this bucket, SELECT and INSERT only
-- ============================================================
create temp view v_pol as
  select policyname, cmd, qual, with_check
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%dcs-documents%';

select is(
  (select array_agg(policyname::text order by policyname) from v_pol),
  array['Admins read dcs documents', 'Admins upload dcs documents',
        'Doc controllers upload dcs documents', 'Originators upload dcs documents',
        'Project role holders read dcs documents'],
  'the five dcs-documents policies, and no other policy mentions the bucket');
select is((select count(*) from v_pol where cmd = 'SELECT'), 2::bigint, 'two SELECT policies');
select is((select count(*) from v_pol where cmd = 'INSERT'), 3::bigint, 'three INSERT policies');
select is(
  (select count(*) from v_pol where cmd in ('UPDATE', 'DELETE', 'ALL')), 0::bigint,
  'no UPDATE, DELETE or ALL policy for the bucket — no overwrite and no delete through the API, not even for the admin');
select is(
  (select count(*) from v_pol where cmd in ('SELECT', 'ALL') and (qual is null or qual in ('true', '(true)'))),
  0::bigint,
  'no SELECT policy with a true/NULL USING clause');
select ok(
  (select with_check like '%aal2%' from v_pol where policyname = 'Doc controllers upload dcs documents'),
  'the DC upload policy requires aal2 in WITH CHECK');
select ok(
  (select with_check not like '%aal%' from v_pol where policyname = 'Originators upload dcs documents'),
  'the Originator upload policy does not mention aal — a second factor is required of the DC, not of everyone');
select is(
  (select count(*) from v_pol where policyname not like 'Admins%'
     and (coalesce(qual, '') || coalesce(with_check, '')) not like '%storage.foldername(objects.name)%'),
  0::bigint,
  'every non-admin policy is keyed on storage.foldername(objects.name) — the project_code segment');
select policies_are('storage', 'objects',
  array['Admins can read all export files', 'Admins can view all receipts',
        'Users can delete own receipts', 'Users can read own export files',
        'Users can upload own receipts', 'Users can view own receipts',
        'Admins read dcs documents', 'Admins upload dcs documents',
        'Doc controllers upload dcs documents', 'Originators upload dcs documents',
        'Project role holders read dcs documents'],
  'the six Timesheet storage policies (20260827125731) are untouched');
select ok(
  has_table_privilege('authenticated', 'storage.objects', 'select')
  and has_table_privilege('authenticated', 'storage.objects', 'insert')
  and has_table_privilege('authenticated', 'storage.objects', 'update')
  and has_table_privilege('authenticated', 'storage.objects', 'delete'),
  'authenticated holds SELECT/INSERT/UPDATE/DELETE on storage.objects — so every refusal below is RLS, not a missing grant');
select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'RLS is enabled on storage.objects');
select is(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like '%dcs documents' and roles <> '{authenticated}'),
  0::bigint,
  'all five policies are TO authenticated');
select ok(
  not has_table_privilege('anon', 'public.projects', 'select'),
  'and the reason holds: anon has no SELECT on public.projects, so the policies are declared for the only role that can evaluate their subquery');

-- ============================================================
-- 3. NOT NULL on dcs.files (red without the migration)
-- ============================================================
select col_not_null('dcs', 'files', 'file_name', 'files.file_name is NOT NULL');
select col_not_null('dcs', 'files', 'original_name', 'files.original_name is NOT NULL');
select col_not_null('dcs', 'files', 'storage_path', 'files.storage_path is NOT NULL');

-- A real revision to hang rows on, as postgres (the generator assigns the
-- numbers; PEJ has mdr_settings from the seed).
create temp table t as
select
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  (select id from public.projects where project_code = 'SCMS-IT') as it_id,
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid as orig_pej_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid as dc_pej_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid as orig_it_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc4'::uuid as outsider_id,
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc5'::uuid as view_pej_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as ra_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as disc_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as en_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC') as idc_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IDC') as idc_status_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as ns_id;
grant select on t to authenticated;

select is((select project_code from public.projects where id = (select pej_id from t)), 'SC2602',
  'seed: PEJ is SC2602');
select is((select project_code from public.projects where id = (select it_id from t)), 'SCMS-IT',
  'seed: IT is SCMS-IT');

create temp table t_doc as
  with ins as (
    insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, '1b09 storage', ra_id, disc_id, area_id, en_id, ns_id from t
    returning id
  ) select id from ins;
create temp table t_rev as
  with ins as (
    insert into dcs.revisions (document_id, project_id, step_id, status_id)
    select (select id from t_doc), pej_id, idc_id, idc_status_id from t
    returning id
  ) select id from ins;

select lives_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select id from t_rev), pej_id, 'SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_01.pdf',
           'drawing.pdf', 'SC2602/x/A/01.pdf', 'original' from t$$,
  'a complete row is accepted');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select id from t_rev), pej_id, null, 'drawing.pdf', 'SC2602/x/A/02.pdf', 'original' from t$$,
  '23502', null,
  'RED: file_name NULL is refused (23502)');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select id from t_rev), pej_id, 'n.pdf', null, 'SC2602/x/A/03.pdf', 'original' from t$$,
  '23502', null,
  'RED: original_name NULL is refused (23502)');
select throws_ok(
  $$insert into dcs.files (revision_id, project_id, file_name, original_name, storage_path, file_kind)
    select (select id from t_rev), pej_id, 'n.pdf', 'drawing.pdf', null, 'original' from t$$,
  '23502', null,
  'RED: storage_path NULL is refused (23502)');
select is((select count(*) from dcs.files where revision_id = (select id from t_rev)), 1::bigint,
  'and only the complete row is in the table');

-- ============================================================
-- 4. Fixtures for RLS: four users, three project roles, five objects
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
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'orig-pej-1b09@example.com', 'Originator PEJ 1b09'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid, 'dc-pej-1b09@example.com', 'DC PEJ 1b09'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid, 'orig-it-1b09@example.com', 'Originator IT 1b09'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4'::uuid, 'outsider-1b09@example.com', 'Outsider 1b09'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc5'::uuid, 'view-pej-1b09@example.com', 'Viewer PEJ 1b09')
) as u(id, email, name);

insert into dcs.project_roles (project_id, user_id, role)
select pej_id, orig_pej_id, 'orig'::dcs.project_role from t
union all select pej_id, dc_pej_id, 'dc'::dcs.project_role from t
union all select it_id, orig_it_id, 'orig'::dcs.project_role from t
union all select pej_id, view_pej_id, 'view'::dcs.project_role from t;

select is((select count(*) from storage.objects), 0::bigint,
  'storage.objects is empty before the fixtures (a database from db reset) — the bare counts below depend on it');

insert into storage.objects (bucket_id, name) values
  ('dcs-documents', 'SC2602/DOC/A/1.pdf'),
  ('dcs-documents', 'SC2602/DOC/A/2.pdf'),
  ('dcs-documents', 'SCMS-IT/DOC/A/1.pdf'),
  ('dcs-documents', 'orphan.pdf'),
  ('dcs-documents', 'SC9999/DOC/A/1.pdf');
select is((select count(*) from storage.objects), 5::bigint,
  'postgres sees all five fixture objects: two under SC2602, one under SCMS-IT, one at the root, one under a code no project has');

create function pg_temp.as_user(p_user uuid, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- ============================================================
-- 5. SELECT — 403 is 0 rows on a bare count
-- ============================================================
set local role authenticated;

select pg_temp.as_user((select outsider_id from t), 'aal2');
select is((select count(*) from storage.objects), 0::bigint,
  'RED: an outsider sees 0 objects, even at aal2');

select pg_temp.as_user((select ernest_id from t), 'aal1');
select is((select count(*) from storage.objects), 0::bigint,
  'RED: a TES member of PEJ with no DCS role sees 0 objects — a project_assignments row reads dcs.files metadata but not bytes (O-16, decided on PR #80)');
select is((select count(*) from dcs.files), 1::bigint,
  'while the same user still reads the dcs.files row of PEJ — the metadata half of O-16, deliberately unchanged');

select pg_temp.as_user((select tymon_id from t), 'aal1');
select is((select count(*) from storage.objects), 0::bigint,
  'RED: a TES member of IT with no DCS role sees 0 objects either');

select pg_temp.as_user((select view_pej_id from t), 'aal1');
select is((select count(*) from storage.objects), 2::bigint,
  'GREEN: a VIEW of PEJ — a DCS role that writes nothing — sees the two SC2602 objects: any dcs.project_roles row on the project reads');

select pg_temp.as_user((select orig_pej_id from t), 'aal1');
select is((select count(*) from storage.objects), 2::bigint,
  'GREEN: the Originator of PEJ sees the two SC2602 objects');
select is((select array_agg(name order by name) from storage.objects),
  array['SC2602/DOC/A/1.pdf', 'SC2602/DOC/A/2.pdf'],
  'and they are exactly the SC2602 ones — not the root object, not SC9999');

select pg_temp.as_user((select dc_pej_id from t), 'aal1');
select is((select count(*) from storage.objects), 2::bigint,
  'GREEN: the DC of PEJ sees the same two (reading needs no aal2)');

select pg_temp.as_user((select orig_it_id from t), 'aal1');
select is((select count(*) from storage.objects), 1::bigint,
  'the Originator of IT sees only the SCMS-IT object');

select pg_temp.as_user((select admin_id from t), 'aal2');
select is((select count(*) from storage.objects), 5::bigint,
  'the admin sees all five, the root and SC9999 objects included — "Admins read" has no path condition, like "Admins manage files"');

reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok(
  $$select count(*) from storage.objects$$,
  '42501', null,
  'RED: anon cannot even count storage.objects (42501) — pre-existing since 20260831143841: the Timesheet policies (TO public) call is_admin(), which anon may not execute; the five 1b.09 policies are TO authenticated and add nothing to this');
reset role;

-- ============================================================
-- 6. INSERT — 403 is 42501
-- ============================================================
set local role authenticated;

-- Originator of PEJ, aal1
select pg_temp.as_user((select orig_pej_id from t), 'aal1');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/3.pdf')$$,
  'GREEN: the Originator of PEJ at aal1 uploads under SC2602/');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SCMS-IT/DOC/A/2.pdf')$$,
  '42501', null,
  'RED: the same Originator cannot upload under SCMS-IT/ — an ORIG of another project (42501)');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'orphan2.pdf')$$,
  '42501', null,
  'RED: nor at the bucket root, outside any project folder (42501)');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC9999/DOC/A/2.pdf')$$,
  '42501', null,
  'RED: nor under a code no project has (42501)');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('timesheet-exports', 'SC2602/DOC/A/3.pdf')$$,
  '42501', null,
  'RED: nor into another bucket with a valid-looking key — the policies are bucket-scoped (42501)');

-- TES member of PEJ with no DCS role, aal2
select pg_temp.as_user((select ernest_id from t), 'aal2');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/4.pdf')$$,
  '42501', null,
  'RED: a TES member with no DCS role cannot upload (42501) even at aal2');
select pg_temp.as_user((select view_pej_id from t), 'aal2');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/4.pdf')$$,
  '42501', null,
  'RED: a VIEW of PEJ cannot upload (42501) even at aal2 — reading is any role, writing is ORIG or DC');

-- Outsider
select pg_temp.as_user((select outsider_id from t), 'aal2');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/4.pdf')$$,
  '42501', null,
  'RED: an outsider cannot upload (42501)');

-- Originator of IT: wrong project first, own project second
select pg_temp.as_user((select orig_it_id from t), 'aal1');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/4.pdf')$$,
  '42501', null,
  'RED: the Originator of IT cannot upload under SC2602/ (42501)');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SCMS-IT/DOC/A/2.pdf')$$,
  'GREEN: but uploads under SCMS-IT/, the project of their role');

-- DC of PEJ: aal1 refused, aal2 accepted
select pg_temp.as_user((select dc_pej_id from t), 'aal1');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/5.pdf')$$,
  '42501', null,
  'RED: the DC of PEJ at aal1 cannot upload (42501) — 1a.11''s rule, applied to the bucket');
select pg_temp.as_user((select dc_pej_id from t), 'aal2');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/5.pdf')$$,
  'GREEN: the DC of PEJ at aal2 uploads under SC2602/');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SCMS-IT/DOC/A/3.pdf')$$,
  '42501', null,
  'RED: the DC of PEJ at aal2 still cannot upload under SCMS-IT/ (42501)');

-- Admin, aal1: no aal condition, mirroring "Admins manage files"
select pg_temp.as_user((select admin_id from t), 'aal1');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/6.pdf')$$,
  'the admin uploads under SC2602/');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC9999/DOC/A/2.pdf')$$,
  'and even under a code no project has — the admin policy has no path condition, like "Admins manage files"; PR 2 never builds such a key');

reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('dcs-documents', 'SC2602/DOC/A/7.pdf')$$,
  '42501', null,
  'RED: anon cannot upload (42501)');
reset role;

select is((select count(*) from storage.objects), 10::bigint,
  'postgres: five fixtures plus the five accepted uploads (ORIG PEJ, ORIG IT, DC PEJ aal2, admin ×2) — every refused INSERT left nothing behind');

-- ============================================================
-- 7. UPDATE and DELETE — no policy, so RLS hides every row: 0 rows touched,
--    for the Originator who uploaded the object and for the admin alike.
--    storage.allow_delete_query stands the storage-api's own statement-level
--    delete guard (storage.protect_delete, present in the local image) aside
--    so that what is measured is RLS, not that trigger.
-- ============================================================
create function pg_temp.rows_updated(p_from text, p_to text) returns bigint language plpgsql as $$
declare n bigint;
begin
  update storage.objects set name = p_to where name = p_from;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.rows_deleted(p_name text) returns bigint language plpgsql as $$
declare n bigint;
begin
  delete from storage.objects where name = p_name;
  get diagnostics n = row_count;
  return n;
end $$;

set local role authenticated;
select pg_temp.as_user((select orig_pej_id from t), 'aal1');
select is(
  pg_temp.rows_updated('SC2602/DOC/A/1.pdf', 'SC2602/DOC/A/1-renamed.pdf'),
  0::bigint,
  'RED: the Originator of PEJ updates 0 rows — no UPDATE policy, the row they can read is invisible to UPDATE');
select is(
  pg_temp.rows_updated('SC2602/DOC/A/3.pdf', 'SC2602/DOC/A/3-renamed.pdf'),
  0::bigint,
  'RED: nor the object they uploaded themselves — no overwrite through the API');
set local storage.allow_delete_query = 'true';
select is(
  pg_temp.rows_deleted('SC2602/DOC/A/3.pdf'),
  0::bigint,
  'RED: the Originator deletes 0 rows — no DELETE policy');

select pg_temp.as_user((select admin_id from t), 'aal2');
select is(
  pg_temp.rows_updated('SC2602/DOC/A/1.pdf', 'SC2602/DOC/A/1-renamed.pdf'),
  0::bigint,
  'RED: the admin at aal2 updates 0 rows too');
select is(
  pg_temp.rows_deleted('SC2602/DOC/A/1.pdf'),
  0::bigint,
  'RED: and deletes 0 rows — Void, not delete, and not even for the admin');
reset role;

select is((select count(*) from storage.objects), 10::bigint,
  'postgres: still ten objects, none renamed, none gone');
select is((select count(*) from storage.objects where name like '%renamed%'), 0::bigint,
  'and no object carries a renamed key');

-- ============================================================
-- 8. The functions the policies call are the 1a.09 ones, unchanged
-- ============================================================
select is(
  (select count(*) from pg_proc
    where oid in ('public.is_project_member(uuid)'::regprocedure,
                  'public.has_project_role(uuid, dcs.project_role[])'::regprocedure,
                  'public.is_doc_controller(uuid)'::regprocedure)),
  3::bigint,
  'is_project_member, has_project_role and is_doc_controller exist with their 1a.09 signatures');
select ok(
  (select qual not like '%is_project_member%' and qual like '%has_project_role%'
     from v_pol where policyname = 'Project role holders read dcs documents'),
  'the SELECT policy calls has_project_role, not is_project_member — the O-16 narrowing; is_project_member would admit a project_assignments row');
select is(
  (select regexp_replace(qual, '.*ARRAY\[(.*?)\].*', '\1')
     from v_pol where policyname = 'Project role holders read dcs documents'),
  (select string_agg(quote_literal(e::text) || '::dcs.project_role', ', ' order by e)
     from unnest(enum_range(null::dcs.project_role)) e),
  'and its literal role list is every value of dcs.project_role — a seventh role must be added to the policy consciously, it does not inherit access');
select is(
  (select count(*) from v_pol where policyname not like 'Admins%'
     and (coalesce(qual, '') || coalesce(with_check, ''))
         not like '%FROM projects p%'),
  0::bigint,
  'every non-admin policy resolves the code through public.projects (no new helper function, advisor 0029 unchanged)');

select * from finish();
rollback;
