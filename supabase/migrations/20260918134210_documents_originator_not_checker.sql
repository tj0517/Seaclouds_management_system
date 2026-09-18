-- DCS 1b.04: the Originator may not also be the Checker.
--
-- docs/00-glossary.md, Originator (ORIG): "Nie może być Checkerem tej samej
-- rewizji." The rule is stated there about a REVISION; this constraint sits on
-- the DOCUMENT's default-staffing columns, which is where 1b.04's form sets
-- them. Those two are related, not identical, and the difference is worth
-- writing down: dcs.documents.originator_id / checker_id are the defaults
-- Phase 2 will copy into approval_tasks per revision (1b.01's own column
-- comment), so stopping the collision here stops it from being copied — it
-- does NOT stop a Phase 2 task from being reassigned into a collision later.
-- The per-revision half of the rule belongs to the approval machinery that
-- does not exist yet; this is the half 1b.04 can actually hold.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (confirmed before it was written)
-- ------------------------------------------------------------------
-- 1. A CHECK constraint, not a trigger. The rule compares two columns of the
--    row being written and needs nothing else — no other table, no session, no
--    OLD. That is exactly what a CHECK expresses, and unlike a trigger it is
--    visible in \d, cannot be ordered wrongly against the other four BEFORE
--    triggers on this table, and is enforced on every path including postgres.
--
-- 2. Both NULL escapes are REQUIRED, and `is distinct from` is deliberately
--    NOT used. originator_id and checker_id are both nullable (1b.01), and
--    `null is distinct from null` is FALSE — so a bare
--    `check (originator_id is distinct from checker_id)` would evaluate to
--    false and REJECT an unstaffed document. Unstaffed documents are a real
--    state: the SMDR import (1b.12-1b.15) carries historical rows whose
--    staffing is unknown, and the register is empty today, so nothing would
--    have warned us later. Written out longhand, a row with either column NULL
--    passes.
--
-- 3. Checker/Approver and Originator/Approver are NOT constrained. Nothing in
--    docs/00-glossary.md or the brief says the Approver may not be one of the
--    other two; only the ORIG/CHK pair is written down. Adding the other two
--    pairs would be inventing a rule, and a CHECK is expensive to walk back
--    once rows exist.
--
-- 4. NOT NULL is NOT added to either column. Requiring both to be set would
--    make the historical import impossible to load, which is irreversible in
--    the way that matters — the data would simply never arrive.
--
-- Read before writing (docs/03-conventions.md: object definitions come from
-- the database or the baseline, never from memory): pg_constraint on
-- dcs.documents carries exactly one CHECK today,
-- documents_budget_hours_non_negative. pg_trigger carries seven triggers, none
-- of which reads checker_id. Across the whole of supabase/migrations/,
-- checker_id appears twice: its column definition and its index, both in
-- 20260917130035. Nothing existing covers this rule.

alter table dcs.documents
  add constraint documents_originator_not_checker
  check (
    originator_id is null
    or checker_id is null
    or originator_id <> checker_id
  );

comment on constraint documents_originator_not_checker on dcs.documents is
  'The Originator may not also be the Checker of the same document '
  '(docs/00-glossary.md, ORIG). Raises 23514. Either column NULL passes: both '
  'are nullable and the SMDR import (1b.12-1b.15) carries documents whose '
  'staffing is unknown, so `is distinct from` — which rejects the both-NULL '
  'row — would have made that import impossible. Covers the DEFAULT staffing '
  'on the document; the same rule per revision belongs to the Phase 2 approval '
  'machinery, which does not exist yet (DCS 1b.04).';
