-- DCS 1b.04 follow-up: the ORIGINATOR insert path, proven end to end.
--
-- WHY THIS FILE EXISTS, given that rls_document_register.test.sql already has
-- a line reading "GREEN: an ORIG inserts a document at aal1". That assertion is
-- real but it does not prove what 1b.04 shipped, for two separate reasons, and
-- both are closed here rather than by editing that file (it is about 1b.01 and
-- says so):
--
--   1. IMPORT MODE. That file opens 1b.02's escape hatch for its whole
--      transaction (`set local dcs.import_mode = 'on'`, and its own comment
--      explains why: its assertions depend on knowing the numbers). Every
--      INSERT in it therefore carries a hand-written scl_doc_number and
--      dcs.next_doc_number NEVER RUNS. The form does the opposite — it leaves
--      the column NULL and lets documents_assign_scl_number call the generator
--      inside the same statement. That path, as an Originator, was untested.
--      This file sets no hatch, supplies no number, and asserts the hatch is
--      off so a later edit cannot quietly reintroduce it.
--
--   2. THE ADMIN POLICY COULD HAVE BEEN DOING THE WORK. The policies on
--      dcs.documents are PERMISSIVE, so they OR together, and "Admins manage
--      documents" is FOR ALL USING/WITH CHECK (select is_admin()). Any caller
--      who is both an admin and an orig passes on the admin policy alone and
--      tells you nothing about "Originators insert documents". The smoke test
--      on scl-dev was run by exactly such an account. The caller below holds
--      project role `orig` AND NOTHING ELSE — public.profiles.role is the
--      'employee' that handle_new_user() assigns — and the file asserts
--      is_admin() is false for them BEFORE it asserts the insert succeeds. That
--      precondition is the point of the file; without it the GREEN is hollow.
--
-- No aal is faked upward anywhere here. "Originators insert documents" carries
-- no aal2 condition (unlike the DC policy) and this file deliberately does not
-- "fix" or compensate for that — it is a known, separately recorded gap. The
-- caller runs at aal1, which is what an Originator really has.
--
-- Cast:
--   orig_only  orig-only-1b04@example.com  project role `orig` on PEJ, nothing
--                                          on IT, profiles.role = employee
-- Projects:
--   PEJ (SC2602) the project they may write to
--   IT  (SCMS-IT) the project they hold no role on — enrolled in MDR by the
--                 fixture on purpose, so the refusal below can only come from
--                 RLS and never from documents_mdr_required
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values (
  '00000000-0000-0000-0000-000000000000',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid, 'authenticated', 'authenticated',
  'orig-only-1b04@example.com', 'x', now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Originator only'), now(), now(),
  '', '', '', '', '', '', '', 0);

create temp table t_fixture as
select
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid as orig_id,
  '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'::uuid as pej_id,
  '094e130b-599b-4295-87fa-697fb71e7fc4'::uuid as it_id,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA') as doc_type_id,
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00') as discipline_id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00') as area_id,
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN') as language_id,
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED') as status_id;
grant select on t_fixture to authenticated;

-- The only role this user gets, anywhere.
insert into dcs.project_roles (project_id, user_id, role)
select pej_id, orig_id, 'orig'::dcs.project_role from t_fixture;

-- IT is enrolled in DCS so that the RED case below is decided by RLS alone.
-- Without this row documents_mdr_required would refuse the insert first, with a
-- 23514, and the test would pass while proving the wrong thing.
insert into dcs.mdr_settings (project_id)
select it_id from t_fixture
on conflict (project_id) do nothing;
insert into dcs.mdr_settings (project_id)
select pej_id from t_fixture
on conflict (project_id) do nothing;

-- ============================================================
-- 1. The cast is what it claims to be
-- ============================================================
select is(
  (select count(*) from dcs.mdr_settings m, t_fixture f
    where m.project_id in (f.pej_id, f.it_id)),
  2::bigint,
  'both projects carry an mdr_settings row, so documents_mdr_required cannot be what refuses anything below');

select is(
  coalesce(current_setting('dcs.import_mode', true), ''),
  '',
  'the 1b.02 import hatch is OFF in this session — the generator really runs on every insert below');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);

select is(
  (select public.is_admin()), false,
  'PRECONDITION: the caller is NOT an admin, so "Admins manage documents" cannot be what admits the insert');

select is(
  (select array_agg(pr.role::text order by pr.role::text)
     from dcs.project_roles pr, t_fixture f
    where pr.user_id = f.orig_id and pr.project_id = f.pej_id),
  array['orig'],
  'PRECONDITION: on PEJ the caller holds orig and only orig — not dc, so the DC policy cannot be what admits it either');

select is(
  (select count(*) from dcs.project_roles pr, t_fixture f
    where pr.user_id = f.orig_id and pr.project_id = f.it_id),
  0::bigint,
  'PRECONDITION: on IT the caller holds no role at all');

-- ============================================================
-- 2. GREEN — the real path: no number supplied, the generator runs
-- ============================================================
select lives_ok(
  $$insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select pej_id, 'Originator end-to-end document', doc_type_id, discipline_id, area_id, language_id, status_id
      from t_fixture$$,
  'GREEN: a caller holding ONLY project role orig inserts a document with no scl_doc_number — "Originators insert documents" is what admits it');

reset role;

select is(
  (select count(*) from dcs.documents d, t_fixture f
    where d.project_id = f.pej_id and d.title = 'Originator end-to-end document'),
  1::bigint,
  'the row is really there, written by the Originator and not by postgres');

select matches(
  (select d.scl_doc_number from dcs.documents d, t_fixture f
    where d.project_id = f.pej_id and d.title = 'Originator end-to-end document'),
  '^SC2602-SCL-RA-[0-9]{4}-EN$',
  'and the number on it was generated by dcs.next_doc_number — PROJECT-ORIG-TYPE-SEQ-LANG, four-digit SEQ');

-- ============================================================
-- 3. RED — the same caller, a project they hold no role on
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select orig_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);

select throws_ok(
  $$insert into dcs.documents (project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
    select it_id, 'Document on a project the caller has no role on', doc_type_id, discipline_id, area_id, language_id, status_id
      from t_fixture$$,
  '42501', null,
  'RED: the same Originator is refused (42501) on a project where they hold no role — the orig grant is per project, not global');

reset role;

select is(
  (select count(*) from dcs.documents d, t_fixture f where d.project_id = f.it_id),
  0::bigint,
  'and the refusal left nothing behind on that project');

select * from finish();
rollback;
