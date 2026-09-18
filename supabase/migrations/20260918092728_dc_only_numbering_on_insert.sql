-- DCS 1b.03: the CPY number becomes the DC's on INSERT too.
--
-- Brief §6.3–6.4: the CPY number is the client's, it may be set only by the
-- project's Document Controller, it is unique within the project rather than
-- globally, and every change is in the audit log with its previous value.
-- 1b.01 put that rule in enforce_dc_only_numbering() and attached it BEFORE
-- UPDATE only — named there as a deliberate gap, and again in
-- docs/deferred-tasks.md (oo). The gap is real: anyone who passes the INSERT
-- policy on dcs.documents ("Originators insert documents", no aal2) could
-- create a row with cpy_doc_number already filled and never touch the rule.
-- This migration closes it, in the database, on both tables that carry the
-- trigger.
--
-- What this migration does NOT change: the UPDATE path. The comparison, the
-- two checks, the SQLSTATE and the message a DC sees on UPDATE are what they
-- were; the only difference is that "what the value is compared against" is
-- now chosen by TG_OP instead of being OLD unconditionally.
--
-- The SCL side of the same sentence was closed by 1b.02 for documents
-- (documents_assign_scl_number refuses a supplied scl_doc_number outright, so
-- it needs no DC check — nobody may hand-enter one). This is the CPY side.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (confirmed before it was written)
-- ------------------------------------------------------------------
-- 1. scl_revision is NOT included on the INSERT side, although
--    revisions_numbering_dc_only guards it on UPDATE. dcs.revisions.scl_revision
--    is NOT NULL, so every INSERT supplies one, so "a non-NULL value counts as
--    a change" would mean only a DC in an aal2 session may create a revision
--    at all. That contradicts docs/00-glossary.md (the Originator "tworzy
--    dokument i rewizje"), makes the "Originators insert revisions" policy
--    unreachable, and is not the rule this task is about. The INSERT side of
--    scl_revision is not a DC lock but a generator, in the shape 1b.02 gave
--    scl_doc_number, and it belongs with the screen that picks the step and
--    therefore the series — 1b.08, docs/deferred-tasks.md (pp).
--
--    So dcs.revisions ends up with TWO triggers on this one function rather
--    than one BEFORE INSERT OR UPDATE: the argument list is a property of the
--    trigger, not of the operation, and the two operations guard different
--    column sets here. dcs.documents needs only one, because cpy_doc_number is
--    nullable and is its whole argument list.
--
-- 2. The auth.uid() bypass stays exactly as 1b.01 wrote it, comment included,
--    and now covers INSERT as well. supabase/seed.sql writes no document
--    today, but migrations, psql and service_role must keep being able to
--    create a row with a CPY number already on it — every one of those callers
--    bypasses RLS on this table anyway, so refusing here would only make this
--    one column the single thing postgres cannot repair.
--
-- 3. Still SECURITY INVOKER with EXECUTE revoked from every API role. The
--    function reads nothing but the row and dcs.project_roles through
--    public.is_doc_controller(), which is SECURITY DEFINER already and which
--    authenticated may execute. Advisor 0029 counts SECURITY DEFINER functions
--    authenticated may execute, so the baseline of 12 does not move; the
--    REVOKE is re-stated because CREATE OR REPLACE keeps the existing ACL but
--    a future CREATE would not, and supabase/tests/advisor_grants.test.sql is
--    what holds the line either way.
--
-- Not done here, deliberately: the setCpyNumber() server action and the
-- editable field in the document profile (1b.07 — there is no screen yet), and
-- the UNIQUE (project_id, cpy_doc_number) constraint, which 1b.01 already
-- created and this task only asserts.

-- ==================================================================
-- 1. The function: branch on TG_OP instead of always reading OLD.
-- ==================================================================
create or replace function public.enforce_dc_only_numbering() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new);
  v_col text;
  v_before jsonb;
  v_verb text := case when tg_op = 'INSERT' then 'set' else 'changed' end;
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

  -- OLD exists only on UPDATE; reading it on INSERT raises "record old is not
  -- assigned yet". It cannot be guarded by a CASE either — plpgsql passes the
  -- record to the query as a parameter, so it is expanded before the CASE
  -- chooses a branch. Hence a statement, not an initialiser.
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  foreach v_col in array tg_argv loop
    -- What the row's value is judged against. UPDATE: the stored value, as
    -- before. INSERT: JSON null — there is nothing stored, so supplying a
    -- value at all is the change this rule guards. It must be JSON null and
    -- not SQL NULL: to_jsonb(new) -> col of an empty column is jsonb 'null',
    -- and ('null'::jsonb is distinct from NULL) is true, which would trip the
    -- rule on every INSERT that leaves the column alone.
    v_before := case when tg_op = 'UPDATE' then v_old -> v_col else 'null'::jsonb end;

    if v_before is distinct from (v_new -> v_col) then
      if not public.is_doc_controller(new.project_id) then
        raise exception
          '%.%.% may be % only by the Document Controller of this project (dcs.project_roles role ''dc''). Caller: %.',
          tg_table_schema, tg_table_name, v_col, v_verb,
          coalesce(auth.uid()::text, '<no session>')
          using errcode = 'insufficient_privilege';
      end if;
      if ((select auth.jwt()) ->> 'aal') is distinct from 'aal2' then
        raise exception
          '%.%.% may be % only in a session with a verified second factor (aal2). Current assurance level: %.',
          tg_table_schema, tg_table_name, v_col, v_verb,
          coalesce(((select auth.jwt()) ->> 'aal'), '<no session>')
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

comment on function public.enforce_dc_only_numbering() is
  'BEFORE INSERT OR UPDATE row trigger for dcs.documents / dcs.revisions. '
  'Takes the guarded column names as trigger arguments and raises 42501 unless '
  'the caller is the project''s DC (public.is_doc_controller) in an aal2 '
  'session: on UPDATE when one of the columns changes, on INSERT when one of '
  'them is supplied at all. RLS cannot express the UPDATE half — a policy sees '
  'either the old row (USING) or the new one (WITH CHECK), never both — and '
  'cannot express the INSERT half either, because the INSERT policies decide '
  'who may create the row, not which columns they may fill, and column-level '
  'GRANTs are per role, not per project. Sessionless callers (migration, seed, '
  'psql, service_role) pass — they bypass RLS on this table anyway. The INSERT '
  'side is DCS 1b.03; the argument lists differ per operation on dcs.revisions '
  '(see the triggers).';

-- CREATE OR REPLACE keeps the ACL this function already has, so this is a
-- re-statement rather than a repair. It is here because the dcs/public default
-- privileges grant EXECUTE to authenticated, and a later CREATE (not REPLACE)
-- of this function would pick them up silently — advisor 0028/0029 territory,
-- guarded by supabase/tests/advisor_grants.test.sql.
revoke execute on function public.enforce_dc_only_numbering()
  from public, anon, authenticated, service_role;

-- ==================================================================
-- 2. The triggers.
-- ==================================================================
--
-- dcs.documents: one trigger, both operations, the same single column.
-- cpy_doc_number is nullable, so "left alone on INSERT" is a real state and an
-- Originator creating a document never meets this rule.
--
-- DROP and CREATE rather than an ALTER: Postgres has no "alter trigger … for
-- insert or update". The window between them is inside this migration's
-- transaction, so no write is ever unguarded.
drop trigger documents_numbering_dc_only on dcs.documents;

create trigger documents_numbering_dc_only
  before insert or update on dcs.documents
  for each row execute function public.enforce_dc_only_numbering('cpy_doc_number');

-- dcs.revisions: two triggers, because the guarded column sets differ by
-- operation. UPDATE keeps both numbering columns, exactly as 1b.01 left it.
-- INSERT guards cpy_revision alone: scl_revision is NOT NULL, so every INSERT
-- supplies one, and guarding it here would mean no Originator could ever
-- create a revision. Its INSERT side is a generator and belongs to 1b.08
-- (docs/deferred-tasks.md pp), not a DC lock.
--
-- Named so it still sorts after revisions_cpy_numbering (BEFORE triggers fire
-- in name order): a CPY value on a project that runs no CPY numbering is
-- refused as 23514 before this trigger asks who the caller is, which is the
-- order 1b.01 established and the existing tests assert.
create trigger revisions_numbering_dc_only_insert
  before insert on dcs.revisions
  for each row execute function public.enforce_dc_only_numbering('cpy_revision');

-- ==================================================================
-- 3. Column comments: the rule they describe now holds on both paths.
-- ==================================================================
comment on column dcs.documents.cpy_doc_number is
  'The client''s document number (CPY track, docs/00-glossary.md). NULL until '
  'the client issues one. Unique within the project, not globally '
  '(documents_project_id_cpy_doc_number_key, 1b.01). Writable only by that '
  'project''s DC in an aal2 session — on INSERT as well as UPDATE since 1b.03 '
  '(trigger documents_numbering_dc_only). Rejected outright on a project whose '
  'dcs.mdr_settings.cpy_numbering is false, or which has no mdr_settings row.';

comment on column dcs.revisions.cpy_revision is
  'The client''s revision marker, free format. Rejected on a project with '
  'cpy_numbering false or no dcs.mdr_settings row. Writable only by that '
  'project''s DC in an aal2 session — on INSERT as well as UPDATE since 1b.03 '
  '(triggers revisions_numbering_dc_only_insert / revisions_numbering_dc_only).';

comment on column dcs.revisions.scl_revision is
  'The revision marker of the SCL track (A, B… for IDC; 00, 01… for IFR; 1, 2… '
  'for the final revisions). Unique within the document. Changing it after the '
  'fact needs the project''s DC at aal2 (trigger revisions_numbering_dc_only). '
  'The INSERT side is deliberately NOT a DC lock: the column is NOT NULL, so '
  'locking it would mean only a DC could create a revision. Its format is '
  'unvalidated and its value still caller-supplied — both belong to 1b.08, the '
  'New Revision dialog, where the step and therefore the series is chosen '
  '(docs/deferred-tasks.md pp).';
