-- DCS 1b.08, part 1 of 3: the SUPERSEDED workflow status.
--
-- When a new revision becomes a document's current one, the revision it
-- replaces is marked SUPERSEDED (migration 3 of this task,
-- revisions_promote_current). That needs a status to mark it with, and
-- workflow_status had none: it holds the nine states a DOCUMENT is in
-- (NOT_STARTED … VOID), and "this revision was replaced" is a state of a
-- REVISION.
--
-- Data, not structure, so it is a migration and not seed.sql, for the reason
-- 1a.18 gives: `supabase db push` never runs the seed and the dictionaries
-- exist on every environment. `on conflict do nothing` for the same reason as
-- there too — from the first apply on the register is the DC's to manage
-- (brief §5.8), so a row a DC already created by hand under this code is left
-- alone rather than overwritten.
--
-- sort_order 100: after VOID (90), the last of the nine. It is not a step in
-- the lifecycle, so it does not belong between any two of them.
--
-- What this row is NOT: a status a person picks. The document-status pickers
-- and filters in apps/dcs leave it out (a document is never "superseded", only
-- a revision is), and it is a system value — the trigger looks it up by code.
-- Nothing in the database stops a DC deactivating or deleting it through the
-- 1a.15 screen; that is the O-15 risk docs/deferred-tasks.md (oo) already
-- records for the step codes, and it is deliberately NOT settled here. What
-- this task does instead is fail loudly: the promotion trigger raises a named
-- error when the row is missing, and never skips the supersede silently.
insert into dcs.dictionaries (dict_type, code, label, description, sort_order, is_active)
values (
  'workflow_status', 'SUPERSEDED', 'Superseded',
  'Set by the system on a revision when a newer revision becomes the current one of its document. Not a state a person chooses, and not a state of a document.',
  100, true
)
on conflict (dict_type, code) do nothing;
