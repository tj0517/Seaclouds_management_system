-- DCS 1b.05: the MDR register view — dcs.v_mdr.
--
-- The register is the system's main screen (brief §9.2) and mirrors the SMDR
-- spreadsheet the team has used for years. Annex C requires keeping the
-- sheet's column groups, so this view is shaped by the SHEET, not by what the
-- schema happens to hold today: every annex-C column is present, and the ones
-- with no source yet are typed NULLs rather than missing columns. Phase 2 then
-- swaps the view's source instead of changing the screen's layout.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration
--
-- All of them were settled before a line of it was written, but they are NOT
-- all the same KIND of decision, and decision 2 says which is which. Do not
-- flatten them into "the owner approved this migration".
-- ------------------------------------------------------------------
-- 1. The stage-date columns (IDC / IFR / RETCOM / IFC-IFI × Planned /
--    Forecast / Actual / stage revision — sixteen in all) are NULL constants.
--    The Notion task said this view joins dcs.plan_dates; that table DOES NOT
--    EXIST. Read from information_schema.tables for schema dcs on scl-dev
--    2026-09-19: dictionaries, documents, files, mdr_settings, project_roles,
--    revisions — six tables, no plan_dates. Planned/Forecast dates are Phase 2
--    (tasks 2.12–2.14). Confirmed before writing: keep the columns as typed
--    NULLs so the layout stays 1:1 with the sheet.
--
-- 2. WORKFLOW > Type is a NULL constant, and TWO things about it are worth
--    stating plainly. First, whose call it was: decision 1 above is the
--    OWNER'S, taken in the 1b.05 task text with its reasoning. This one is
--    NOT — the gap was found, the options framed and the recommendation made
--    by the implementer mid-task, and the owner accepted it. Accepted, but not
--    an owner's ruling from the brief, and it must not be presented as one.
--    Second, why it is empty — it is NOT a deferred-source column like the
--    dates above: nothing in the brief, the glossary or docs/02-data-model.md
--    says what the sheet's WORKFLOW "Type" holds. Orig / Ch'd / App'd map
--    cleanly onto documents.originator_id / checker_id / approver_id; "Type"
--    maps onto nothing. Mapping it to the current revision's workflow step was
--    considered and rejected: the STATUS group already carries the workflow
--    status, so that would have shipped a duplicated column that READ as
--    agreed. It ships empty and visible instead, which is the question asked
--    at the demo rather than a guess baked into the schema.
--
-- 3. security_invoker = true. Without it a view is read with the OWNER's
--    permissions, and dcs.v_mdr would hand every authenticated user every
--    project's register — the exact "a view must not widen access" failure
--    CLAUDE.md names. With it, "Project members read documents" on
--    dcs.documents is what decides the rows, unchanged. Asserted by
--    supabase/tests/mdr_register_view.test.sql, both as a catalog fact
--    (reloptions) and as a behavioural one (a non-member counts zero).
--
-- 4. Every join is a LEFT JOIN, including the five dictionary joins whose
--    foreign keys make the row's existence certain. Not defensive habit: an
--    INNER join would make a future narrowing of RLS on dcs.dictionaries or
--    public.projects silently DELETE documents from the register — the worst
--    possible failure mode for a register whose job is to be complete. A LEFT
--    join degrades to a row with an empty label, which is visible.
--    dcs.documents is the driving table and its RLS is the gate.
--
-- 5. ORIG and SEQ are parsed out of scl_doc_number FROM THE RIGHT, not by
--    field index. public.projects.project_code may itself contain a hyphen —
--    SCMS-IT is a live project code on scl-dev (O-11), so SCMS-IT-SCL-RA-0001-EN
--    has six fields, not five, and split_part(…, '-', 2) would return 'IT'.
--    dcs.next_doc_number (1b.02) already reads SEQ from the right for exactly
--    this reason; this view follows it rather than inventing a second parser.
--    ORIG and SEQ have no columns of their own anywhere in the schema — the
--    number is their only source.

-- ==================================================================
-- 1. pg_trgm — the combined search
-- ==================================================================
--
-- One search box over scl_doc_number + cpy_doc_number + title, matching
-- anywhere in any of the three ('%emo%' finds 'demo'). An infix match cannot
-- use a btree index at all, so without a trigram index every keystroke is a
-- sequential scan over the whole register.
--
-- Installed into `extensions`, which is where Supabase puts extensions and is
-- already on the API search_path (config.toml [api].extra_search_path). NOT
-- into public: that would put ~30 functions and operators into the schema
-- PostgREST exposes.
--
-- Rejected alternative, on the record: a GIN index over
-- to_tsvector('simple', …), which needs no extension. It does word-PREFIX
-- matching, so searching 'emo' would not find 'demo', and document numbers
-- tokenise on the hyphen into several lexemes. That is a different search from
-- the one the task asks for, dressed as the same one.
create extension if not exists pg_trgm with schema extensions;

-- The three searchable columns as one indexed expression. The page's search
-- predicate must be written EXACTLY like this — character for character — or
-- the planner will not match it to the index; apps/dcs/lib/mdr.ts builds it
-- from the same constant and mdr_register_view.test.sql pins the plan.
--
-- Honest limit, measured rather than assumed (local stack, 2026-09-19): the
-- planner only CHOOSES this index once the table is large. At 200 rows and at
-- 2 000 rows it correctly prefers a sequential scan — reading a tiny table end
-- to end is genuinely cheaper — and it switches to the index at around 20 000.
-- The register holds 1 row today and 146 after the 1b.13 import, so for a long
-- while this index will not be used and the performance advisor will report it
-- as unused_index. That is expected and is not a reason to drop it.
create index documents_search_idx on dcs.documents
  using gin (
    (
      coalesce(scl_doc_number, '') || ' ' ||
      coalesce(cpy_doc_number, '') || ' ' ||
      coalesce(title, '')
    ) extensions.gin_trgm_ops
  );

comment on index dcs.documents_search_idx is
  'DCS 1b.05: trigram index behind the MDR register''s single search box, '
  'which matches a fragment anywhere in scl_doc_number, cpy_doc_number or '
  'title. The query never rewrites this expression — it filters on the '
  'dcs.v_mdr column search_text, which IS this expression, so the two cannot '
  'drift apart (apps/dcs/lib/mdr.ts, listMdrPage).';

-- NO INDEX IS ADDED FOR THE DEFAULT SORT, and this is a finding rather than an
-- omission — the task asked which indexes support the default sort and why, so
-- here is the answer with the measurement behind it.
--
-- The default sort is scl_doc_number ascending. It is already served by
-- documents_scl_doc_number_key (UNIQUE, 1b.01) globally, and the register's
-- project filter by documents_project_id_idx (1b.01). The obvious addition
-- would be a composite (project_id, scl_doc_number) giving filter and order in
-- one scan, and it was written, applied and measured on the local stack
-- 2026-09-19 before being removed again. The planner never chose it:
--
--   * 201 rows, 200 of them in the filtered project — chose
--     documents_scl_doc_number_key and filtered project_id out;
--   * 210 rows, only 10 in the filtered project (the selective case the
--     composite is supposed to win) with enable_seqscan = off — chose
--     documents_project_id_idx and sorted the 10 rows afterwards.
--
-- A sort over a handful of rows is cheaper than a wider index scan, so the
-- composite only pays off at a per-project row count this register will not
-- reach for a long time (146 documents arrive with the 1b.12–1b.13 import).
-- Shipping an index no query plan uses would add a fourth entry to the
-- performance advisor's unused_index list for this table and buy nothing.
-- Whoever sees a slow project-filtered sort in real use should add it then,
-- with the plan that motivated it.

-- The other four register filters — document type, discipline, originator and
-- workflow status — need nothing new either: 1b.01 and 1b.01a already give
-- every one of them a covering index (documents_doc_type_id_doc_type_dict_type_idx,
-- documents_discipline_id_discipline_dict_type_idx, documents_originator_id_idx,
-- documents_workflow_status_id_workflow_status_dict_type_idx).

-- ==================================================================
-- 2. dcs.v_mdr
-- ==================================================================
create view dcs.v_mdr
  with (security_invoker = true)
as
select
  -- ---------------------------------------------------------------
  -- Identity and scope. project_id is exposed deliberately: CLAUDE.md
  -- requires it on every dcs.* object carrying project data, it is what the
  -- register's project filter filters on, and it is the column the RLS policy
  -- underneath this view reads.
  -- ---------------------------------------------------------------
  d.id                                        as document_id,
  d.project_id,
  p.project_code,
  p.name                                      as project_name,

  -- ---------------------------------------------------------------
  -- Annex C · DOCUMENT INFO
  -- ---------------------------------------------------------------
  -- Process is the project's, not the document's: public.projects.process_type
  -- (enum public.project_process_type — internal/tender/project/course). Cast
  -- to text so the view exposes no enum, and so a new enum label cannot change
  -- this column's type.
  p.process_type::text                        as process,

  -- ORIG: fourth field from the right. See decision 5 in the header.
  reverse(split_part(reverse(d.scl_doc_number), '-', 4))  as orig_code,

  doc_type.code                               as doc_type_code,

  -- SEQ: second field from the right. Kept as text, not integer — it is a
  -- zero-padded display field ('0001'), and the 1b.13 import may carry
  -- historical numbers whose SEQ field is not four digits.
  reverse(split_part(reverse(d.scl_doc_number), '-', 2))  as seq,

  d.scl_doc_number,
  d.cpy_doc_number,
  d.title,

  -- "Type description" in the sheet: the document type's full name, next to
  -- its code. dcs.dictionaries.label, not .description — label is the short
  -- name the DC maintains for display, description is the longer gloss.
  doc_type.label                              as doc_type_description,

  discipline.code                             as discipline_code,
  discipline.label                            as discipline_label,

  -- CTR: public.sub_projects.code (docs/00-glossary.md). Nullable in the
  -- register because it is nullable on the document — SC2601 on scl-dev has no
  -- CTR codes at all.
  ctr.code                                    as ctr_code,
  ctr.description                             as ctr_description,

  d.budget_hours,

  -- ---------------------------------------------------------------
  -- Annex C · STATUS
  --
  -- The three revision columns come from the document's CURRENT revision
  -- (documents.current_revision_id), which is NULL for every document that has
  -- not been issued yet — all of them today. The sheet shows these cells empty
  -- in the same situation, so an empty STATUS group is the register working,
  -- not the register failing.
  -- ---------------------------------------------------------------
  rev.cpy_revision,
  rev.scl_revision,
  rev.revision_date                           as issue_date,

  -- Status is the DOCUMENT's workflow_status, not the revision's. Both exist
  -- (dcs.revisions.status_id is a workflow_status too), and the sheet's STATUS
  -- column is the document's overall state — a document with no revision still
  -- has one ('NOT_STARTED'), which a revision-sourced column could not show.
  workflow_status.code                        as workflow_status_code,
  workflow_status.label                       as workflow_status_label,

  -- ---------------------------------------------------------------
  -- Annex C · WORKFLOW
  -- ---------------------------------------------------------------
  -- Decision 2 in the header: no source exists for this column. Not a deferred
  -- join like the stage dates below — an open question about what the sheet
  -- means. Typed text so the shape is fixed now and only the expression
  -- changes when it is answered.
  null::text                                  as workflow_type,

  -- The ids, not the names. public.profiles RLS is "own row or admin", so a
  -- join here would show a project member their own name and NULL for every
  -- colleague. Names come from public.dcs_profile_directory() (1a.14b), which
  -- the page calls once — apps/dcs/lib/mdr.ts, and the same pattern the 1b.04
  -- document profile already uses.
  d.originator_id,
  d.checker_id,
  d.approver_id,

  -- ---------------------------------------------------------------
  -- Annex C · the four stage groups — IDC / IFR / RETCOM / IFC-IFI
  --
  -- Sixteen typed NULLs: no dcs.plan_dates table exists (decision 1). The
  -- types are the types Phase 2 will produce — date for the three dates of
  -- each stage, text for the revision issued at it — so that swapping the
  -- source is a change to this view alone and never to the screen or to the
  -- generated TypeScript row type.
  -- ---------------------------------------------------------------
  null::date                                  as idc_planned,
  null::date                                  as idc_forecast,
  null::date                                  as idc_actual,
  null::text                                  as idc_revision,

  null::date                                  as ifr_planned,
  null::date                                  as ifr_forecast,
  null::date                                  as ifr_actual,
  null::text                                  as ifr_revision,

  null::date                                  as retcom_planned,
  null::date                                  as retcom_forecast,
  null::date                                  as retcom_actual,
  null::text                                  as retcom_revision,

  null::date                                  as ifc_ifi_planned,
  null::date                                  as ifc_ifi_forecast,
  null::date                                  as ifc_ifi_actual,
  null::text                                  as ifc_ifi_revision,

  -- ---------------------------------------------------------------
  -- Filter keys. Not annex-C columns and not rendered: the register's
  -- dropdowns filter by dictionary id, so the ids have to travel with the row
  -- for the SQL WHERE clause to be expressible against the view alone. Area
  -- and language are here for the same reason and because the profile screen
  -- (1b.07) reads them from the register row rather than re-reading the table.
  -- ---------------------------------------------------------------
  d.doc_type_id,
  d.discipline_id,
  d.area_id,
  d.language_id,
  d.workflow_status_id,
  area.code                                   as area_code,
  area.label                                  as area_label,
  language.code                               as language_code,

  -- The combined search field, and the reason it is a COLUMN rather than an
  -- expression the page writes into its WHERE clause.
  --
  -- The register is read over PostgREST, which can filter on a column but
  -- cannot express `(a || ' ' || b || ' ' || c) ilike '%q%'` as a filter at
  -- all. Written the only way PostgREST allows — three separate .ilike()s
  -- OR-ed together — the predicate would no longer match the single
  -- concatenated expression documents_search_idx is built on, and every search
  -- would fall back to a sequential scan with the index sitting there unused.
  -- Exposing the expression as a column makes `search_text=ilike.*q*` a legal
  -- PostgREST filter that the planner still pushes down to the index, which is
  -- what mdr_register_view.test.sql asserts against the plan.
  --
  -- It is a FILTER field, not a display field: the page filters on it without
  -- selecting it, so the concatenation never travels over the wire. Never
  -- render it — it is three columns glued together and reads as nonsense.
  (
    coalesce(d.scl_doc_number, '') || ' ' ||
    coalesce(d.cpy_doc_number, '') || ' ' ||
    coalesce(d.title, '')
  )                                           as search_text,

  d.created_at,
  d.updated_at
from dcs.documents d
  -- Every join LEFT, including the five whose foreign keys guarantee a match.
  -- Decision 4 in the header: an INNER join would let a future RLS change on a
  -- joined table remove documents from the register without a trace.
  left join public.projects     p              on p.id  = d.project_id
  left join dcs.dictionaries    doc_type       on doc_type.id       = d.doc_type_id
  left join dcs.dictionaries    discipline     on discipline.id     = d.discipline_id
  left join dcs.dictionaries    area           on area.id           = d.area_id
  left join dcs.dictionaries    language       on language.id       = d.language_id
  left join dcs.dictionaries    workflow_status on workflow_status.id = d.workflow_status_id
  left join dcs.revisions       rev            on rev.id            = d.current_revision_id
  left join public.sub_projects ctr            on ctr.id            = d.ctr_code;

comment on view dcs.v_mdr is
  'DCS 1b.05: the MDR register (brief §9.2) — one row per document, carrying '
  'every annex-C column group of the SMDR spreadsheet. security_invoker = '
  'true, so the rows are exactly the rows the caller may read from '
  'dcs.documents; this view grants nothing of its own. Columns with no source '
  'in the schema yet are typed NULLs so the layout stays 1:1 with the sheet: '
  'the sixteen stage-date columns (no dcs.plan_dates table — Phase 2, tasks '
  '2.12–2.14) and workflow_type (annex C WORKFLOW > Type, whose meaning is '
  'not recorded anywhere and was deliberately not guessed).';

-- ==================================================================
-- 3. Grants
-- ==================================================================
--
-- The dcs schema's default privileges (1a.05) grant ALL on new tables to
-- authenticated, and a view is a table to that rule — so this view was already
-- readable the moment it was created, and would also have been INSERT/UPDATE/
-- DELETE-able if it were auto-updatable. It is not (a view with joins never
-- is), so nothing was actually writable. Narrowing it to SELECT anyway, so the
-- guarantee is a written grant rather than a property of the query shape that
-- a future simplification could remove without anyone noticing.
revoke all on dcs.v_mdr from authenticated, service_role;
grant select on dcs.v_mdr to authenticated, service_role;
