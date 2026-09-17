-- DCS 1b.01: the document register — dcs.documents, dcs.revisions, dcs.files.
-- The three tables the whole of Phase 1b builds on: numbering (1b.02), CPY
-- editing (1b.03), the register and dialogs (1b.04–1b.08), storage (1b.09),
-- the final-revision lock (1b.10) and the SMDR import (1b.12–1b.15) all write
-- here. Nothing above is in this migration; this is the schema they land on.
--
-- ONE migration for three tables, against the "two independent tables are two
-- migrations" rule in docs/03-conventions.md, because these three are not
-- independent: documents.current_revision_id and revisions.document_id form a
-- cycle, and files hangs off revisions. Splitting them would mean a migration
-- that cannot be applied on its own.
--
-- dcs.mdr_settings is NOT touched (it is read by one trigger, never written).
-- No Phase 2–3 table (approval_tasks, plan_dates, comments, transmittals) is
-- created here: their shape is not settled and an empty guessed table is worse
-- than no table.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (all confirmed before it was written)
-- ------------------------------------------------------------------
-- O-15 (revisions.step: Postgres enum vs dictionary FK) is resolved HERE in
-- favour of the dictionary FK: revisions.step_id references dcs.dictionaries
-- of dict_type 'workflow_step'. Reason: since 1a.07 every DCS code list is a
-- dictionary row a DC can manage without a deploy, and the six workflow_step
-- codes are already seeded (IDC, IFR, RETCOM, IFC, IFI, IFB — no START, which
-- matches "start is not a revision"). docs/04-open-questions.md is updated in
-- the same PR. The risk O-15 itself named is NOT closed here: nothing stops a
-- DC deactivating a step the state machine depends on. That guard belongs to
-- the state machine (Phase 2), not to this schema.
--
-- O-06 (CTR codes company-wide vs per project) stays OPEN. ctr_code points at
-- public.sub_projects, which is per project today (project_id NOT NULL,
-- UNIQUE (project_id, code)) — the same shape 1a.17 deliberately left alone.
-- If O-06 later makes CTR codes company-wide, this FK and the trigger below
-- change together.
--
-- project_id is a REAL column on all three tables, not a lookup through the
-- parent. The decisive reason is not query cost: public.audit_trigger() takes
-- audit_log.project_id from the row's own project_id column, so without it
-- every revision and file entry would be logged with project_id NULL and fall
-- outside the "Doc controllers read own project audit log" policy (1a.09) —
-- only a global admin could ever read that part of the trail, which is the
-- opposite of what an audit trail is for in a client dispute. The
-- denormalisation is kept honest by composite foreign keys, not by trust:
-- a revision's (document_id, project_id) must match a real documents row, and
-- a file's (revision_id, project_id) a real revisions row.
--
-- Dictionary type integrity is declarative, not a trigger. Each dictionary FK
-- carries a STORED generated column holding the dict_type it is allowed to
-- point at, and the foreign key is composite against a new
-- UNIQUE (id, dict_type) on dcs.dictionaries. So discipline_id cannot hold a
-- 'language' row, and — unlike a trigger — the dictionary row's own dict_type
-- cannot be changed out from under an existing document either (dict_type is
-- otherwise unguarded, docs/deferred-tasks.md (bb)). The cost is eight
-- read-only columns that show up in packages/db/src/database.ts; they are
-- constants, never written by anyone.
--
-- ------------------------------------------------------------------
-- Why the numbering rules are triggers and not policies
-- ------------------------------------------------------------------
-- "Only the DC may change the numbering fields" cannot be written as RLS. A
-- policy's USING clause sees the old row and WITH CHECK the new one; neither
-- can express OLD.cpy_doc_number = NEW.cpy_doc_number. Column-level
-- GRANT UPDATE(col) is per role (`authenticated`), not per user, so it cannot
-- say "the DC of THIS project". The rule therefore lives in BEFORE UPDATE
-- triggers that raise 42501 — the same SQLSTATE a policy denial would produce,
-- with a message that names the rule.
--
-- scl_doc_number is stricter than the task's "DC only": it is immutable for
-- everyone, DC and admin included, exactly like dcs.dictionaries.code
-- (1a.15b). docs/00-glossary.md: a wrong document is Voided and replaced, its
-- number never returns to the pool — there is no reading under which the
-- number on an existing row is rewritten.

-- ==================================================================
-- 0. Prerequisite on dcs.dictionaries: a unique key the composite FKs
--    can reference. (id) is already the primary key, so (id, dict_type)
--    is trivially unique — this constraint adds no rule, only a target.
-- ==================================================================
alter table dcs.dictionaries
  add constraint dictionaries_id_dict_type_key unique (id, dict_type);

comment on constraint dictionaries_id_dict_type_key on dcs.dictionaries is
  'Target for the composite dictionary foreign keys of dcs.documents and '
  'dcs.revisions (DCS 1b.01). Adds no constraint of its own — id is already '
  'the primary key — but it is what makes "this id must be a row of dict_type '
  'X" expressible as a foreign key instead of a trigger.';

-- ==================================================================
-- 1. dcs.documents
-- ==================================================================
create table dcs.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Numbering. No generator in this task: 1b.02 adds the atomic sequence and
  -- makes manual entry impossible. Until then the number is supplied by the
  -- caller, and there is no caller — no screen writes this table yet.
  scl_doc_number text not null,
  cpy_doc_number text,

  title text not null,

  -- Dictionary-backed columns. NOT NULL: doc_type and language are segments of
  -- the SCL number (PROJECT-ORIG-TYPE-SEQ-LANG), so a document missing them
  -- cannot be numbered at all by 1b.02; discipline, area and workflow_status
  -- are register columns the SMDR always carries. All five dictionaries are
  -- seeded (1a.18), area down to a "00 General" code.
  doc_type_id uuid not null,
  discipline_id uuid not null,
  area_id uuid not null,
  language_id uuid not null,
  workflow_status_id uuid not null,

  -- Default staffing from the MDR, NOT the source of truth for the workflow:
  -- Phase 2 copies these into approval_tasks when a revision is created, and a
  -- change here only affects future revisions (docs/02-data-model.md). The
  -- rule that each of them must hold the matching dcs.project_roles role is
  -- deliberately NOT enforced here — it needs a trigger and belongs with the
  -- screen that sets them (1b.04). Recorded in docs/02-data-model.md.
  originator_id uuid references public.profiles (id),
  checker_id uuid references public.profiles (id),
  approver_id uuid references public.profiles (id),

  -- CTR code (docs/00-glossary.md). Nullable: SC2601 on scl-dev has no CTR
  -- codes at all, so NOT NULL would make its documents impossible to create.
  -- Named ctr_code rather than ctr_code_id to match docs/02-data-model.md and
  -- the language the DC uses, although it holds a uuid.
  ctr_code uuid references public.sub_projects (id),

  budget_hours numeric,

  -- Set once revisions exists (section 2): FK is added after the table it
  -- points at, which is simpler and cheaper than DEFERRABLE.
  current_revision_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Read-only discriminators for the composite dictionary FKs below. Constants:
  -- nothing writes them, and they exist only so a foreign key can say "of this
  -- dict_type".
  doc_type_dict_type text generated always as ('doc_type'::text) stored,
  discipline_dict_type text generated always as ('discipline'::text) stored,
  area_dict_type text generated always as ('area'::text) stored,
  language_dict_type text generated always as ('language'::text) stored,
  workflow_status_dict_type text generated always as ('workflow_status'::text) stored,

  constraint documents_scl_doc_number_key unique (scl_doc_number),
  -- Per project, and only for rows that have one: standard NULL distinctness
  -- means any number of documents may sit without a CPY number.
  constraint documents_project_id_cpy_doc_number_key unique (project_id, cpy_doc_number),
  -- Target for the composite FK from dcs.revisions.
  constraint documents_id_project_id_key unique (id, project_id),

  constraint documents_doc_type_id_fkey foreign key (doc_type_id, doc_type_dict_type)
    references dcs.dictionaries (id, dict_type),
  constraint documents_discipline_id_fkey foreign key (discipline_id, discipline_dict_type)
    references dcs.dictionaries (id, dict_type),
  constraint documents_area_id_fkey foreign key (area_id, area_dict_type)
    references dcs.dictionaries (id, dict_type),
  constraint documents_language_id_fkey foreign key (language_id, language_dict_type)
    references dcs.dictionaries (id, dict_type),
  constraint documents_workflow_status_id_fkey foreign key (workflow_status_id, workflow_status_dict_type)
    references dcs.dictionaries (id, dict_type),

  constraint documents_budget_hours_non_negative check (budget_hours >= 0)
);

comment on table dcs.documents is
  'The document register (brief §5.3). One row per document of a project; its '
  'issues live in dcs.revisions. scl_doc_number is globally unique and '
  'immutable; cpy_doc_number is the client''s parallel number, unique within '
  'the project and writable only by that project''s DC at aal2. ON DELETE '
  'CASCADE from projects: a document without its project is a leftover, and '
  'project deletion is already admin-gated in TES.';
comment on column dcs.documents.scl_doc_number is
  'PROJECT-ORIG-TYPE-SEQ-LANG (e.g. SC2601-SCL-RA-0012-EN). Generated '
  'atomically by 1b.02 — until then supplied by the caller. Immutable after '
  'insert, for every role including admin (trigger '
  'documents_scl_number_immutable): a wrong document is Voided and replaced, '
  'its number never returns to the pool.';
comment on column dcs.documents.cpy_doc_number is
  'The client''s document number (CPY track, docs/00-glossary.md). NULL until '
  'the client issues one. Rejected outright on a project whose '
  'dcs.mdr_settings.cpy_numbering is false, or which has no mdr_settings row.';
comment on column dcs.documents.ctr_code is
  'CTR activity this document is booked under — public.sub_projects. Must '
  'belong to the same project (trigger documents_ctr_code_project); O-06 may '
  'still make CTR codes company-wide, which would change both.';
comment on column dcs.documents.current_revision_id is
  'The revision currently in force. Constrained to a revision OF THIS DOCUMENT '
  'by a composite foreign key, not by application code.';
comment on column dcs.documents.originator_id is
  'Default staffing from the MDR, not the source of truth for the workflow: '
  'Phase 2 copies it into approval_tasks per revision. Changing it affects '
  'future revisions only.';
comment on column dcs.documents.doc_type_dict_type is
  'Constant, read-only: the dict_type doc_type_id is allowed to point at. '
  'Exists so the foreign key can enforce it — never written by anyone.';

-- Every foreign key gets a covering index (advisor lint 0001), plus project_id
-- itself, which every RLS policy on this table filters on.
create index documents_project_id_idx on dcs.documents (project_id);
create index documents_doc_type_id_idx on dcs.documents (doc_type_id);
create index documents_discipline_id_idx on dcs.documents (discipline_id);
create index documents_area_id_idx on dcs.documents (area_id);
create index documents_language_id_idx on dcs.documents (language_id);
create index documents_workflow_status_id_idx on dcs.documents (workflow_status_id);
create index documents_originator_id_idx on dcs.documents (originator_id);
create index documents_checker_id_idx on dcs.documents (checker_id);
create index documents_approver_id_idx on dcs.documents (approver_id);
create index documents_ctr_code_idx on dcs.documents (ctr_code);
create index documents_current_revision_id_idx on dcs.documents (current_revision_id);

-- ==================================================================
-- 2. dcs.revisions
-- ==================================================================
create table dcs.revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  -- Denormalised from the document and held to it by the composite FK below;
  -- see the header for why it is a column and not a join.
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Format validation (A,B,… / 00,01,… / 1,2,…) is NOT here: which series
  -- applies depends on the step, and the rule belongs with the generator
  -- (1b.02), not duplicated in a CHECK that would then drift.
  scl_revision text not null,
  cpy_revision text,

  step_id uuid not null,
  reason_for_issue text,
  revision_date date,
  acceptance_code_id uuid,
  status_id uuid not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  step_dict_type text generated always as ('workflow_step'::text) stored,
  acceptance_code_dict_type text generated always as ('acceptance_code'::text) stored,
  status_dict_type text generated always as ('workflow_status'::text) stored,

  -- Both halves at once: the document exists, and its project is the project
  -- written on this row. One constraint, no trigger, no way to drift.
  constraint revisions_document_id_project_id_fkey foreign key (document_id, project_id)
    references dcs.documents (id, project_id) on delete cascade,

  constraint revisions_step_id_fkey foreign key (step_id, step_dict_type)
    references dcs.dictionaries (id, dict_type),
  constraint revisions_acceptance_code_id_fkey foreign key (acceptance_code_id, acceptance_code_dict_type)
    references dcs.dictionaries (id, dict_type),
  constraint revisions_status_id_fkey foreign key (status_id, status_dict_type)
    references dcs.dictionaries (id, dict_type),

  constraint revisions_document_id_scl_revision_key unique (document_id, scl_revision),
  -- Targets for the composite FKs from dcs.documents and dcs.files.
  constraint revisions_id_document_id_key unique (id, document_id),
  constraint revisions_id_project_id_key unique (id, project_id)
);

comment on table dcs.revisions is
  'One issue of a document (brief §5.4): its step, dates, acceptance code and '
  'files. scl_revision is unique within the document. The immutability of '
  'final revisions (IFC/IFI/IFB) is 1b.10, not this migration.';
comment on column dcs.revisions.project_id is
  'Copy of the document''s project, held to it by the composite foreign key on '
  '(document_id, project_id). It is a column rather than a join because '
  'public.audit_trigger() reads project scope from this column — without it '
  'every revision entry in public.audit_log would be invisible to the DC.';
comment on column dcs.revisions.step_id is
  'Workflow step (dict_type workflow_step). This is where O-15 is resolved: a '
  'dictionary row, not a Postgres enum, so a DC can manage the list without a '
  'deploy — at the price that nothing yet stops one deactivating a step the '
  'Phase 2 state machine needs.';
comment on column dcs.revisions.cpy_revision is
  'The client''s revision marker, free format. Rejected on a project with '
  'cpy_numbering false or no dcs.mdr_settings row; writable only by that '
  'project''s DC at aal2.';

create index revisions_document_id_idx on dcs.revisions (document_id);
create index revisions_project_id_idx on dcs.revisions (project_id);
create index revisions_step_id_idx on dcs.revisions (step_id);
create index revisions_acceptance_code_id_idx on dcs.revisions (acceptance_code_id);
create index revisions_status_id_idx on dcs.revisions (status_id);
create index revisions_created_by_idx on dcs.revisions (created_by);

-- The other half of the cycle. (id, current_revision_id) against
-- (document_id, id) is what makes "the current revision must be a revision OF
-- THIS DOCUMENT" a foreign key. ON DELETE SET NULL is column-scoped (Postgres
-- 15+) — without the column list it would try to NULL the document's own id.
alter table dcs.documents
  add constraint documents_current_revision_id_fkey
  foreign key (id, current_revision_id) references dcs.revisions (document_id, id)
  on delete set null (current_revision_id);

-- ==================================================================
-- 3. dcs.files
-- ==================================================================
create table dcs.files (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Nullable until 1b.09: it owns the generated name
  -- ([SCL_DOC_NUMBER]_[REV]_[STEP]_[YYYY-MM-DD]_[NN].[ext]), the bucket and
  -- the signed-URL access. Nothing writes this table yet, so NOT NULL here
  -- would be a promise no code keeps; 1b.09 tightens all three.
  file_name text,
  original_name text,
  storage_path text,

  -- text + CHECK, not an enum, for the reason 1a.07 gave for
  -- dcs.dictionaries.dict_type: widening a CHECK is an ordinary migration,
  -- widening an enum is an ALTER TYPE. O-09 (automatic PDF renditions) may add
  -- to this list and must not need a type change to do it.
  file_kind text not null,

  sort_order integer not null default 0,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now(),

  constraint files_revision_id_project_id_fkey foreign key (revision_id, project_id)
    references dcs.revisions (id, project_id) on delete cascade,
  constraint files_file_kind_check check (file_kind in (
    'original', 'rendition', 'attachment', 'comment_sheet'
  )),
  constraint files_size_bytes_non_negative check (size_bytes >= 0),
  constraint files_sort_order_non_negative check (sort_order >= 0)
);

comment on table dcs.files is
  'Files of one revision (brief §5.5). The bytes live in Supabase Storage and '
  'are reachable only through signed URLs; this table is the index. Storage '
  'buckets, the generated file_name and the revision folder layout are 1b.09 — '
  'file_name, original_name and storage_path are nullable until then. The '
  'write lock on final revisions is 1b.10.';
comment on column dcs.files.file_kind is
  'original | rendition | attachment | comment_sheet. text + CHECK rather than '
  'an enum so O-09 can add a kind in an ordinary migration.';

create index files_revision_id_idx on dcs.files (revision_id);
create index files_project_id_idx on dcs.files (project_id);
create index files_uploaded_by_idx on dcs.files (uploaded_by);

-- ==================================================================
-- 4. Triggers
--
-- All four functions live in public next to is_admin(), forbid_dictionary_
-- code_change() and audit_trigger() — the established home for cross-schema
-- helpers (1a.09/1a.14b/1a.17). All are SECURITY INVOKER (the default):
-- raising an exception needs no elevated rights, and the two that read a table
-- read one every authenticated user may read anyway (dcs.mdr_settings,
-- public.sub_projects), so no SECURITY DEFINER is needed and advisor lint 0029
-- gains nothing. EXECUTE is revoked from every API role: it is checked when
-- the trigger is created (as postgres), never when it fires, and leaving the
-- default grant would put the functions in front of anon (lint 0028, guarded
-- by supabase/tests/advisor_grants.test.sql).
--
-- All BEFORE triggers are named so they sort before set_updated_at (BEFORE
-- triggers fire in name order), so a rejected write leaves neither an
-- updated_at bump nor an audit_log row.
-- ==================================================================

-- ------------------------------------------------------------------
-- 4a. scl_doc_number is immutable, unconditionally.
-- ------------------------------------------------------------------
create function public.forbid_scl_doc_number_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.scl_doc_number is distinct from old.scl_doc_number then
    raise exception
      'dcs.documents.scl_doc_number is immutable (% -> %): a document number is issued once and never returns to the pool. Void this document and create a new one instead.',
      old.scl_doc_number, new.scl_doc_number
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.forbid_scl_doc_number_change() is
  'BEFORE UPDATE row trigger for dcs.documents: raises when scl_doc_number '
  'changes. Unconditional — no role bypass, including admin and DC (DCS '
  '1b.01), same shape as forbid_dictionary_code_change() (1a.15b).';

revoke execute on function public.forbid_scl_doc_number_change()
  from public, anon, authenticated, service_role;

create trigger documents_scl_number_immutable
  before update on dcs.documents
  for each row execute function public.forbid_scl_doc_number_change();

-- ------------------------------------------------------------------
-- 4b. Numbering columns are the DC's, and only at aal2.
--
-- The columns are passed as trigger arguments so one function serves both
-- tables. It reads project_id from the row, which both tables carry.
--
-- Note what this does NOT stop: someone who holds BOTH orig and dc on the
-- project passes the ORIG policy at aal1 for ordinary edits — but this trigger
-- still refuses their numbering change unless the session is aal2. The RLS
-- policies decide who may write the row at all; this decides who may move a
-- number.
-- ------------------------------------------------------------------
create function public.enforce_dc_only_numbering() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
begin
  -- No session: a migration, supabase/seed.sql, a psql console or a
  -- service_role call. There is no dcs.project_roles row to check and no aal
  -- to read, and every one of those callers already bypasses RLS on this
  -- table, so refusing here would only make this one column the single thing
  -- postgres cannot repair. This is an AUTHORIZATION rule — it decides which
  -- of several signed-in users may act — unlike the immutability of
  -- scl_doc_number, which is a fact about the number and has no bypass at all.
  if auth.uid() is null then
    return new;
  end if;

  foreach v_col in array tg_argv loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      if not public.is_doc_controller(new.project_id) then
        raise exception
          '%.%.% may be changed only by the Document Controller of this project (dcs.project_roles role ''dc''). Caller: %.',
          tg_table_schema, tg_table_name, v_col,
          coalesce(auth.uid()::text, '<no session>')
          using errcode = 'insufficient_privilege';
      end if;
      if ((select auth.jwt()) ->> 'aal') is distinct from 'aal2' then
        raise exception
          '%.%.% may be changed only in a session with a verified second factor (aal2). Current assurance level: %.',
          tg_table_schema, tg_table_name, v_col,
          coalesce(((select auth.jwt()) ->> 'aal'), '<no session>')
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

comment on function public.enforce_dc_only_numbering() is
  'BEFORE UPDATE row trigger for dcs.documents / dcs.revisions. Takes the '
  'numbering column names as trigger arguments and raises 42501 if one of them '
  'changes without the caller being the project''s DC (public.is_doc_controller) '
  'in an aal2 session. RLS cannot express this: a policy sees either the old '
  'row (USING) or the new one (WITH CHECK), never both, and column-level '
  'GRANTs are per role, not per project. Sessionless callers (migration, seed, '
  'psql, service_role) pass — they bypass RLS on this table anyway.';

revoke execute on function public.enforce_dc_only_numbering()
  from public, anon, authenticated, service_role;

-- UPDATE only, deliberately. Nothing here stops an Originator INSERTing a
-- document with cpy_doc_number already filled in — that is the same rule at a
-- different moment, and it belongs to the tasks that own the two write paths:
-- 1b.02 makes manual entry of scl_doc_number impossible in every form and
-- action, 1b.03 owns the CPY editing UX. Named here so the gap is a decision
-- on the record, not an oversight.
create trigger documents_numbering_dc_only
  before update on dcs.documents
  for each row execute function public.enforce_dc_only_numbering('cpy_doc_number');

create trigger revisions_numbering_dc_only
  before update on dcs.revisions
  for each row execute function public.enforce_dc_only_numbering('scl_revision', 'cpy_revision');

-- ------------------------------------------------------------------
-- 4c. No CPY numbers on a project that does not run CPY numbering.
--
-- dcs.mdr_settings.cpy_numbering = false is how an "SCMS project" is
-- represented. A project with NO mdr_settings row is treated the same way —
-- the column's own default is false, and a missing row means "DCS does not run
-- this project" (1a.05), which is not a state in which a client number can be
-- meaningful. Two projects on scl-dev are in exactly that state (SC2602,
-- SCMS-IT), so this is a live case, not a theoretical one.
--
-- Deliberately NOT done here: refusing to create a document at all for a
-- project with no mdr_settings row. That is a bigger rule than "CPY numbers
-- need CPY numbering", it would decide what "DCS runs this project" means for
-- every future table, and it belongs with the generator (1b.02).
-- ------------------------------------------------------------------
create function public.enforce_cpy_numbering_enabled() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_col text := tg_argv[0];
  v_value text := to_jsonb(new) ->> v_col;
  v_enabled boolean;
begin
  if v_value is null then
    return new;
  end if;

  select m.cpy_numbering into v_enabled
    from dcs.mdr_settings m
   where m.project_id = new.project_id;

  if coalesce(v_enabled, false) then
    return new;
  end if;

  raise exception
    '%.%.% cannot be set on this project: dcs.mdr_settings.cpy_numbering is %. The CPY track is the client''s numbering, and this project does not run one.',
    tg_table_schema, tg_table_name, v_col,
    coalesce(v_enabled::text, 'absent (no mdr_settings row)')
    using errcode = 'check_violation';
end;
$$;

comment on function public.enforce_cpy_numbering_enabled() is
  'BEFORE INSERT OR UPDATE row trigger for dcs.documents / dcs.revisions. '
  'Takes the CPY column name as its trigger argument and rejects a non-NULL '
  'value when the project''s dcs.mdr_settings.cpy_numbering is false OR the '
  'project has no mdr_settings row at all (a missing row means DCS does not '
  'run the project — 1a.05). SECURITY INVOKER: every authenticated user may '
  'already read dcs.mdr_settings.';

revoke execute on function public.enforce_cpy_numbering_enabled()
  from public, anon, authenticated, service_role;

create trigger documents_cpy_numbering
  before insert or update on dcs.documents
  for each row execute function public.enforce_cpy_numbering_enabled('cpy_doc_number');

create trigger revisions_cpy_numbering
  before insert or update on dcs.revisions
  for each row execute function public.enforce_cpy_numbering_enabled('cpy_revision');

-- ------------------------------------------------------------------
-- 4d. ctr_code must be a CTR code of this document's project.
--
-- A trigger rather than a composite foreign key on purpose: the declarative
-- form would need UNIQUE (id, project_id) on public.sub_projects — an ALTER on
-- a table SCL-TES uses in production — and ADR-0003 has dcs reaching into core
-- through foreign keys, not through schema changes to it. The gap this leaves
-- is named rather than hidden: nothing stops a sub_project being moved to
-- another project afterwards, because sub_projects.project_id has no
-- immutability guard today.
-- ------------------------------------------------------------------
create function public.enforce_document_ctr_code_project() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_ctr_project uuid;
begin
  if new.ctr_code is null then
    return new;
  end if;

  select sp.project_id into v_ctr_project
    from public.sub_projects sp
   where sp.id = new.ctr_code;

  if v_ctr_project is distinct from new.project_id then
    raise exception
      'dcs.documents.ctr_code must be a CTR code of the same project: sub_project % belongs to project %, the document to project %.',
      new.ctr_code, coalesce(v_ctr_project::text, '<none>'), new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_document_ctr_code_project() is
  'BEFORE INSERT OR UPDATE row trigger for dcs.documents: ctr_code must point '
  'at a public.sub_projects row of the document''s own project. Raises 23503, '
  'the SQLSTATE the declarative form would raise, so callers need not care '
  'which mechanism enforces it. A trigger and not a composite FK because the '
  'declarative form would require altering a TES production table (ADR-0003).';

revoke execute on function public.enforce_document_ctr_code_project()
  from public, anon, authenticated, service_role;

create trigger documents_ctr_code_project
  before insert or update on dcs.documents
  for each row execute function public.enforce_document_ctr_code_project();

-- ------------------------------------------------------------------
-- 4e. Housekeeping triggers. dcs.files has no updated_at (uploaded_at is the
--     only timestamp it needs), so it gets no set_updated_at.
-- ------------------------------------------------------------------
create trigger set_updated_at
  before update on dcs.documents
  for each row execute function public.set_updated_at();

create trigger set_updated_at
  before update on dcs.revisions
  for each row execute function public.set_updated_at();

-- The eighth, ninth and tenth audited tables. All three have an `id` uuid PK
-- and a project_id column, so audit_trigger() (1a.17b) resolves record_id and
-- project scope with no change at all — which also puts these entries inside
-- the "Doc controllers read own project audit log" policy from 1a.09.
create trigger audit_documents
  after insert or update or delete on dcs.documents
  for each row execute function public.audit_trigger();

create trigger audit_revisions
  after insert or update or delete on dcs.revisions
  for each row execute function public.audit_trigger();

create trigger audit_files
  after insert or update or delete on dcs.files
  for each row execute function public.audit_trigger();

-- ==================================================================
-- 5. RLS
--
-- Shape follows dcs.dictionaries (1a.07/1a.09b/1a.11): an admin FOR ALL
-- policy, a member SELECT policy, and single-command write policies so a later
-- task can `alter policy` one of them without dropping it.
--
-- ORIG and DC get separate write policies rather than one policy naming both
-- roles, because only the DC's writes require aal2 — folding them together
-- would either force a second factor on every Originator or drop it for the
-- DC. Permissive policies OR together, so someone holding both roles passes
-- through the ORIG policy at aal1; the numbering triggers in section 4b are
-- what actually guards the numbers in that case.
--
-- The admin FOR ALL policy carries no aal2 condition, exactly as 1a.11 left
-- the admin policy on dcs.dictionaries. Stated plainly: a global admin at
-- aal1 can write these tables, numbering triggers aside. That is the existing
-- portal-wide shape, not a decision taken here.
--
-- No DELETE policy: deletion stays inside the admin FOR ALL policy. The
-- brief's answer to a wrong document is Void, not delete, and revisions and
-- files disappear with their parent through ON DELETE CASCADE.
--
-- The aal2 test is written as ((select auth.jwt()) ->> 'aal') — the function
-- call alone inside the subselect — rather than 1a.11's
-- (select auth.jwt() ->> 'aal'), which the performance advisor still reports
-- as auth_rls_initplan on dcs.dictionaries today.
-- ==================================================================

alter table dcs.documents enable row level security;
alter table dcs.revisions enable row level security;
alter table dcs.files enable row level security;

-- ------------------------------------------------------------------
-- dcs.documents
-- ------------------------------------------------------------------
create policy "Project members read documents"
  on dcs.documents for select
  using (public.is_project_member(project_id));

create policy "Admins manage documents"
  on dcs.documents for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Originators insert documents"
  on dcs.documents for insert
  with check (public.has_project_role(project_id, array['orig']::dcs.project_role[]));

create policy "Originators update documents"
  on dcs.documents for update
  using (public.has_project_role(project_id, array['orig']::dcs.project_role[]))
  with check (public.has_project_role(project_id, array['orig']::dcs.project_role[]));

create policy "Doc controllers insert documents"
  on dcs.documents for insert
  with check (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

create policy "Doc controllers update documents"
  on dcs.documents for update
  using (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  )
  with check (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

-- ------------------------------------------------------------------
-- dcs.revisions
-- ------------------------------------------------------------------
create policy "Project members read revisions"
  on dcs.revisions for select
  using (public.is_project_member(project_id));

create policy "Admins manage revisions"
  on dcs.revisions for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Originators insert revisions"
  on dcs.revisions for insert
  with check (public.has_project_role(project_id, array['orig']::dcs.project_role[]));

create policy "Originators update revisions"
  on dcs.revisions for update
  using (public.has_project_role(project_id, array['orig']::dcs.project_role[]))
  with check (public.has_project_role(project_id, array['orig']::dcs.project_role[]));

create policy "Doc controllers insert revisions"
  on dcs.revisions for insert
  with check (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

create policy "Doc controllers update revisions"
  on dcs.revisions for update
  using (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  )
  with check (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

-- ------------------------------------------------------------------
-- dcs.files
-- ------------------------------------------------------------------
create policy "Project members read files"
  on dcs.files for select
  using (public.is_project_member(project_id));

create policy "Admins manage files"
  on dcs.files for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Originators insert files"
  on dcs.files for insert
  with check (public.has_project_role(project_id, array['orig']::dcs.project_role[]));

create policy "Originators update files"
  on dcs.files for update
  using (public.has_project_role(project_id, array['orig']::dcs.project_role[]))
  with check (public.has_project_role(project_id, array['orig']::dcs.project_role[]));

create policy "Doc controllers insert files"
  on dcs.files for insert
  with check (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

create policy "Doc controllers update files"
  on dcs.files for update
  using (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  )
  with check (
    public.is_doc_controller(project_id)
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );
