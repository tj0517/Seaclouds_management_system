-- DCS 1b.01a: index every composite foreign key of the document register over
-- its FULL column list, not just its leading column.
--
-- What went wrong in 1b.01. Eleven of the twenty foreign keys on
-- dcs.documents / dcs.revisions / dcs.files are composite, and each got an
-- index on its first column only. The pgTAP assertion written to guard this
-- compared (indkey)[0] against conkey[1] — the leading column — so it passed,
-- while the performance advisor checks the whole column list and did not:
-- unindexed_foreign_keys went 10 → 21 on scl-dev the moment 1b.01 landed
-- (read 2026-09-17, after the merge). The advisor was right and the test was
-- weaker than the rule it claimed to enforce; supabase/tests/
-- rls_document_register.test.sql now checks what the advisor checks, and fails
-- naming the uncovered constraints rather than counting them.
--
-- What this buys, stated honestly. Eight of the eleven second columns are the
-- constant generated *_dict_type columns introduced by 1b.01 for the composite
-- dictionary FKs: doc_type_dict_type holds the literal 'doc_type' on every row
-- that will ever exist. An index on (doc_type_id, doc_type_dict_type) therefore
-- has exactly the selectivity of one on (doc_type_id) — the same number of
-- distinct leading values, one distinct trailing value — and is merely wider.
-- Those eight are advisor compliance, not a performance fix, and it is better
-- to say so here than to let a later reader assume the lint was hiding a real
-- problem.
--
-- The remaining three are real. Their second column carries data:
--   documents_current_revision_id_fkey     (id, current_revision_id)
--   revisions_document_id_project_id_fkey  (document_id, project_id)
--   files_revision_id_project_id_fkey      (revision_id, project_id)
-- Postgres needs these on the referencing side when the referenced row is
-- deleted — the ON DELETE CASCADE from a document to its revisions and files,
-- and the ON DELETE SET NULL (current_revision_id) that fires when a revision
-- is deleted. With the tables empty today that costs nothing; with a project's
-- MDR loaded it is a sequential scan per deleted row.
--
-- Scope: indexes only, on the three tables 1b.01 created. No constraint, no
-- policy, no trigger, no function and no other table is touched — in
-- particular not dcs.dictionaries, dcs.mdr_settings or anything in public.
-- Dropping and creating an index is fully reversible and touches no data.

-- ==================================================================
-- 1. The eight dictionary FKs.
--
--    Each new index is created before its single-column predecessor is
--    dropped, so the foreign key is never without one, even though both
--    statements are inside the same transaction.
--
--    The predecessors are strict prefixes of the new indexes — a btree on
--    (a, b) answers every query a btree on (a) answers — so dropping them
--    removes duplication, not capability.
-- ==================================================================
create index documents_doc_type_id_doc_type_dict_type_idx
  on dcs.documents (doc_type_id, doc_type_dict_type);
drop index dcs.documents_doc_type_id_idx;

create index documents_discipline_id_discipline_dict_type_idx
  on dcs.documents (discipline_id, discipline_dict_type);
drop index dcs.documents_discipline_id_idx;

create index documents_area_id_area_dict_type_idx
  on dcs.documents (area_id, area_dict_type);
drop index dcs.documents_area_id_idx;

create index documents_language_id_language_dict_type_idx
  on dcs.documents (language_id, language_dict_type);
drop index dcs.documents_language_id_idx;

create index documents_workflow_status_id_workflow_status_dict_type_idx
  on dcs.documents (workflow_status_id, workflow_status_dict_type);
drop index dcs.documents_workflow_status_id_idx;

create index revisions_step_id_step_dict_type_idx
  on dcs.revisions (step_id, step_dict_type);
drop index dcs.revisions_step_id_idx;

create index revisions_acceptance_code_id_acceptance_code_dict_type_idx
  on dcs.revisions (acceptance_code_id, acceptance_code_dict_type);
drop index dcs.revisions_acceptance_code_id_idx;

create index revisions_status_id_status_dict_type_idx
  on dcs.revisions (status_id, status_dict_type);
drop index dcs.revisions_status_id_idx;

-- ==================================================================
-- 2. The three parent-link FKs, where both columns carry data.
-- ==================================================================

-- (document_id, project_id) → documents (id, project_id). The existing
-- revisions_document_id_idx is a strict prefix; revisions_project_id_idx is
-- NOT — it covers revisions_project_id_fkey → public.projects and every RLS
-- policy on this table, which filters on project_id. It stays.
create index revisions_document_id_project_id_idx
  on dcs.revisions (document_id, project_id);
drop index dcs.revisions_document_id_idx;

-- (revision_id, project_id) → revisions (id, project_id). Same shape:
-- files_revision_id_idx is a prefix and goes, files_project_id_idx stays.
create index files_revision_id_project_id_idx
  on dcs.files (revision_id, project_id);
drop index dcs.files_revision_id_idx;

-- (id, current_revision_id) → revisions (document_id, id). The odd one: its
-- leading column is the table's own primary key, so documents_pkey and
-- documents_id_project_id_key both start correctly and neither covers the
-- pair. This is the index the ON DELETE SET NULL (current_revision_id) uses
-- when a revision is deleted and Postgres must find the documents pointing at
-- it.
create index documents_id_current_revision_id_idx
  on dcs.documents (id, current_revision_id);

-- documents_current_revision_id_idx is dropped rather than kept. Unlike the
-- ten above it is NOT a prefix of its replacement — (current_revision_id)
-- cannot be served by (id, current_revision_id) — so this is a deliberate
-- removal, not deduplication. 1b.01 created it for exactly one purpose, to
-- cover documents_current_revision_id_fkey, and it never did; the composite
-- above does. Nothing in the schema and nothing in apps/dcs looks a document
-- up by its current revision alone. Reversible in one statement if a later
-- task ever needs that direction.
drop index dcs.documents_current_revision_id_idx;

-- ==================================================================
-- Net effect: eleven indexes created, eleven dropped. The index count on the
-- three tables is unchanged, so the advisor's unused_index total should not
-- move either — the new indexes are as unread as the ones they replace while
-- the tables are empty.
-- ==================================================================
