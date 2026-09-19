-- DCS 1b.06: fixtures for the export-fidelity proof.
--
-- Seeds ~50 documents on the LOCAL stack so the export can be compared, row
-- for row, against dcs.v_mdr. Companion to
-- apps/dcs/lib/mdr-export.fidelity.ts, which runs this file, does the
-- comparison and tears the fixtures down again.
--
-- WHY THIS IS NOT A pgTAP TRANSACTION, said here because the acceptance
-- criterion asked for one: the export talks to PostgREST over HTTP, and an
-- HTTP request cannot see rows held in an uncommitted transaction belonging to
-- a different session. "Seed in a test transaction" and "run the real export"
-- are mutually exclusive. Agreed with the owner 2026-09-19 to keep the real
-- export and get isolation from the local database being disposable plus the
-- teardown at the end. NOTHING HERE MAY EVER BE RUN AGAINST scl-dev OR PROD —
-- the runner's assertLocal() refuses any host but 127.0.0.1.
--
-- Everything is namespaced under fixed UUIDs and the project code SC9906 so
-- teardown is exact rather than a guess.

\set ON_ERROR_STOP on

-- 1b.02's import hatch: supply scl_doc_number by hand. Fifty calls to
-- dcs.next_doc_number would each take an advisory lock to test numbering,
-- which is not what this script is about (same reasoning as the 1b.05 test).
set dcs.import_mode = 'on';

-- Two users: one with a role on the fixture project, one with none. The
-- second is not decoration — the export runs as the member, and the outsider
-- is what makes "the sheet holds what RLS allows" a claim with a control.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, extensions.crypt('fidelity-pass', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(),
  '', '', '', '', '', '', '', 0
from (values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid, 'fidelity-member@example.com', 'Fidelity member'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid, 'fidelity-outsider@example.com', 'Fidelity outsider')
) as u(id, email, name)
on conflict (id) do nothing;

-- Identities, so the member can actually sign in through GoTrue.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.id in ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2')
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

-- Three projects, each earning its place:
--   SC9906  the main fixture, 50 documents, member has `view`
--   SC9907  member has NO role — without it, "the export contains what the
--           member may read" is a claim with no control
--   SC9908  a SECOND readable project, 2 documents, so the filename assertion
--           can be made for two different project codes rather than one
insert into public.projects (id, name, project_code, is_active, process_type)
values
  ('eeeeeeee-0000-4000-8000-000000000001', 'Fidelity fixture', 'SC9906', true, 'internal'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Fidelity other', 'SC9907', true, 'internal'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Fidelity second', 'SC9908', true, 'internal')
on conflict (id) do nothing;

insert into dcs.mdr_settings (project_id, cpy_numbering)
values
  ('eeeeeeee-0000-4000-8000-000000000001', true),
  ('eeeeeeee-0000-4000-8000-000000000002', true),
  ('eeeeeeee-0000-4000-8000-000000000003', true)
on conflict (project_id) do nothing;

insert into dcs.project_roles (project_id, user_id, role)
values
  ('eeeeeeee-0000-4000-8000-000000000001',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'view'),
  ('eeeeeeee-0000-4000-8000-000000000003',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'view')
on conflict do nothing;

-- 50 documents, deliberately VARIED so the three filter sets each select a
-- different, non-trivial subset — a fixture where every row is identical
-- would let a broken filter pass by matching everything.
--   * three document types and three disciplines, cycling — and the codes are
--     REAL ones read from dcs.dictionaries (doc_type has no 'DR' or 'SP'; an
--     earlier version used them and the lateral joins below silently dropped
--     two thirds of the rows, which is exactly the failure the guard after
--     this insert now makes impossible)
--   * two workflow statuses, so a status filter halves the set
--   * every third row carries a CPY number, every fourth an issue date
--   * titles that make a text search select an awkward, non-contiguous subset
insert into dcs.documents (
  project_id, scl_doc_number, cpy_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id, budget_hours)
select
  'eeeeeeee-0000-4000-8000-000000000001',
  'SC9906-SCL-' || t.code || '-' || lpad(g::text, 4, '0') || '-EN',
  case when g % 3 = 0 then 'CPY-9906-' || g else null end,
  case when g % 5 = 0 then 'Platform layout study ' || g else 'Fidelity row ' || g end,
  t.id, d.id,
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00'),
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN'),
  s.id,
  (g % 7) * 1.5
from generate_series(1, 50) g
cross join lateral (
  select id, code from dcs.dictionaries
   where dict_type = 'doc_type' and code = (array['RA', 'TN', 'SA'])[1 + (g % 3)]
) t
cross join lateral (
  select id from dcs.dictionaries
   where dict_type = 'discipline' and code = (array['A00', 'B00', 'C00'])[1 + (g % 3)]
) d
cross join lateral (
  select id from dcs.dictionaries
   where dict_type = 'workflow_status' and code = (array['NOT_STARTED', 'IDC'])[1 + (g % 2)]
) s;

-- Five on the project the member holds no role on, same shape, so an
-- unfiltered export has something it must NOT contain.
insert into dcs.documents (
  project_id, scl_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select
  'eeeeeeee-0000-4000-8000-000000000002',
  'SC9907-SCL-RA-' || lpad(g::text, 4, '0') || '-EN',
  'Fidelity row ' || g || ' on the other project',
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00'),
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00'),
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN'),
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IDC')
from generate_series(1, 5) g;

-- Two on SC9908, the second project the member CAN read. Small on purpose:
-- its whole job is to give the filename assertion a second project code.
insert into dcs.documents (
  project_id, scl_doc_number, title,
  doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
select
  'eeeeeeee-0000-4000-8000-000000000003',
  'SC9908-SCL-RA-' || lpad(g::text, 4, '0') || '-EN',
  'Second project row ' || g,
  (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
  (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00'),
  (select id from dcs.dictionaries where dict_type = 'area' and code = '00'),
  (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN'),
  (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IDC')
from generate_series(1, 2) g;

-- A LATERAL JOIN THAT MATCHES NOTHING DROPS THE ROW, silently and with no
-- error — so a mistyped dictionary code above would seed a smaller fixture and
-- every fidelity comparison would still PASS, comparing two equally wrong
-- sets. This is the guard that makes that impossible.
do $$
declare n int;
begin
  select count(*) into n from dcs.documents
   where project_id = 'eeeeeeee-0000-4000-8000-000000000001';
  if n <> 50 then
    raise exception 'fixture seeded % documents on SC9906, expected 50 — a dictionary code in the insert above does not exist', n;
  end if;
  select count(*) into n from dcs.documents
   where project_id = 'eeeeeeee-0000-4000-8000-000000000003';
  if n <> 2 then
    raise exception 'fixture seeded % documents on SC9908, expected 2', n;
  end if;
end $$;

-- A handful of current revisions, so the STATUS group is not uniformly NULL
-- and the issue_date column has real dates to round-trip through the sheet.
with picked as (
  select id, project_id, row_number() over (order by scl_doc_number) as n
    from dcs.documents
   where project_id = 'eeeeeeee-0000-4000-8000-000000000001'
     and scl_doc_number like 'SC9906-%'
), made as (
  insert into dcs.revisions (document_id, project_id, scl_revision, cpy_revision, step_id, status_id, revision_date)
  select p.id, p.project_id, 'A', 'C01',
         (select id from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IDC'),
         (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IDC'),
         date '2026-09-01' + p.n::int
    from picked p where p.n % 4 = 0
  returning id, document_id
)
update dcs.documents d set current_revision_id = m.id from made m where d.id = m.document_id;

analyze dcs.documents;
