-- DCS 1b.11 (migration 1 of 2, Phase 1 — no workflow engine yet): manual
-- document status change by the DC, an explicit Approve action reusing
-- 1b.10's lock, and a document Void with a mandatory reason. Enforced in the
-- database, per CLAUDE.md — this migration is the enforcement, the UI in the
-- second PR is the message.
--
-- State read on scl-dev before this migration was written (2026-09-22): no
-- drift from the migrations on main — dcs.documents/dcs.revisions carry
-- neither void_reason nor void_at, workflow_status_id/status_id are exactly
-- as 1b.01 left them, and every existing trigger on both tables matches its
-- defining migration byte for byte (checked with pg_get_triggerdef). The ten
-- workflow_status codes and six workflow_step codes are exactly what
-- docs/00-glossary.md and the earlier migrations say.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (owner, before it was written)
-- ------------------------------------------------------------------
-- 1. SUPERSEDED stays system-only, hidden from the DC's status dropdown (a UI
--    decision, PR 2) — not a DB change: SUPERSEDED was already reachable in
--    dcs.revisions.status_id (workflow_status dictionary) before this task,
--    and nothing here restricts who may reach it, because
--    forbid_change_of_locked_revision() (1b.10) already refuses a hand-made
--    SUPERSEDED with no newer revision, for everyone. See point 5 below for
--    the one place this migration DOES touch a status value directly (the
--    revisions INSERT guard).
--
-- 2. The two new DC-only status guards run only against a DIRECT write, not
--    a write promote_new_revision() (1b.08) makes as a cascade of an
--    Originator's INSERT. SECURITY DEFINER changes SQL privilege, not
--    auth.uid() (it reads JWT claims), so without this an Originator could
--    never create a first revision (NOT_STARTED -> STARTED) or any later one
--    (previous revision -> SUPERSEDED). Empirically measured on the local
--    stack, twice (the first measurement was taken inside the trigger BODY
--    and was off by one): a trigger's own WHEN clause sees pg_trigger_depth()
--    ONE LOWER than its body does. A direct client write's WHEN clause sees
--    0; a write cascaded from inside another trigger's own DML (exactly what
--    promote_new_revision does) sees 1. Hence `WHEN (pg_trigger_depth() = 0)`
--    on both new triggers below — not `= 1`, and not on the trigger body.
--    revisions_numbering_dc_only (scl_revision / cpy_revision, 1b.01) is left
--    completely untouched: promote_new_revision never writes those columns,
--    and it guards more than one column, so the WHEN clause cannot be added
--    to it without also gating cpy_revision by mistake.
--
-- 3. void_reason / void_at, protected. An Originator can UPDATE
--    dcs.documents ("Originators update documents" has no column
--    restriction), so without a guard they could rewrite an existing Void's
--    reason or plant a void_at. void_reason joins workflow_status_id on the
--    same DC-only trigger (documents_workflow_status_dc_only); void_at is
--    never client-supplied — enforce_document_void() (new function, so in
--    scope to design from scratch) stamps it itself on the transition into
--    VOID and freezes both columns, by refusal (23001), once the document
--    stays VOID. Leaving VOID is a separate authorization question, point 4.
--
-- 4. An admin (profiles.role = 'admin') may move a document OFF VOID; a DC
--    who is not admin may not — Void is irreversible in ordinary use, but an
--    admin is the named break-glass. This is the one narrow, explicit,
--    owner-authorized exception to "do not change
--    enforce_dc_only_numbering()'s body" (every other guarded column keeps
--    its exact prior behaviour — see the diff at the function below). Chosen
--    of three options laid out and costed in chat: scope the escape to
--    workflow_status_id only, via a generic 'admin:' argument-prefix
--    convention (not by hardcoding table/column names in the function body),
--    with aal2 still required for the admin exactly as for a DC — matching
--    O-14's named intent (2FA for DC AND Administrator, brief §3.5), not the
--    weaker "admin at aal1" shape the rest of this schema's RLS still has.
--    forbid_change_of_locked_revision() (1b.10) is untouched and unaffected:
--    it is a wholly separate trigger on dcs.revisions with its own
--    unconditional "no branch clears locked_at, for anyone" rule, and has no
--    relationship to enforce_dc_only_numbering() at all.
--
-- 5. New scope, added by the owner after reading the app code: status on
--    INSERT was unguarded. workflow_status_id and status_id have no column
--    default and no INSERT trigger checked them, so a caller who passes the
--    two INSERT policies (no aal2 for an Originator) could create a document
--    already IFC or VOID, or a revision with any status, and skip "only DC
--    sets status" entirely.
--      documents: a non-DC caller may INSERT only with workflow_status
--        NOT_STARTED (lib/documents.ts:53 INITIAL_WORKFLOW_STATUS, resolved
--        server-side on every insert, never taken from the client — a single
--        fixed value, cleanly guardable).
--      revisions: NOT "the status the form sends" — read on scl-dev, that is
--        not one value. lib/revisions.ts:49 REVISION_STEP_CODES lets the
--        dialog offer IDC/IFR/IFC/IFI/IFB, unfiltered by role
--        (app/(app)/documents/[documentId]/page.tsx:151, same `stepOptions`
--        for Originator and DC alike; lib/revisions.ts:104 grants `isOrig`
--        the button at aal1). status_id is resolved server-side
--        (lib/revisions.ts:423-431) to the workflow_status row whose CODE
--        equals the chosen step's — "the user picks the step, and no state
--        machine decides it" (lib/revisions.ts:60). So the actual invariant
--        a non-DC caller must keep is not a fixed value or a fixed set: it is
--        that status_id's code equals step_id's code. Anything else needs
--        the project's DC at aal2 — same as every other guard here.
--      Noticed, not touched: REVISION_STEP_CODES and which steps an
--      Originator may pick from the New Revision dialog are existing,
--      documented, working app behaviour (1b.08) and out of scope for this
--      task. This migration does not change what an Originator may choose —
--      only that whatever they choose, status must match it.
--
-- 6. enforce_document_void(): staying VOID freezes void_reason and void_at
--    by refusal (23001), not silent coercion — a change is refused outright
--    rather than quietly reverted, so a caller sees why nothing happened.
--    Leaving VOID (admin only) carries void_reason/void_at over unchanged on
--    purpose: 1b.11 decides nothing about clearing them on an un-Void, which
--    does not exist yet as a flow — recorded in docs/deferred-tasks.md.
--    Trigger order matters and is fixed by name: documents_insert_status_dc_only /
--    documents_workflow_status_dc_only (authorization) sort before
--    documents_workflow_status_void_reason (state consistency) — 'i'/'w' —
--    so a write is judged as "who may do this" before "does this make sense".
--
-- Out of scope, unchanged: forbid_change_of_locked_revision,
-- enforce_locked_at_final_step, promote_new_revision, audit_trigger — none of
-- their bodies are touched by this migration. No workflow-engine table, no
-- new revision-status dictionary entries, no Void-of-a-single-revision, no
-- admin tooling beyond the one enforce_dc_only_numbering() escape above.
--
-- SQLSTATE: 42501 insufficient_privilege — wrong caller (not DC-at-aal2, or
-- not admin-at-aal2 for the one column that allows it). 23514 check_violation
-- — a fact about configuration/data (void_reason required or not allowed
-- given the status; INSERT status must be NOT_STARTED / must match the
-- step). 23001 restrict_violation — refusing a change to something the
-- system treats as settled (void_reason/void_at once VOID; leaving VOID for
-- a non-admin) — the same code 1b.10 used for a locked revision and named,
-- in its own header, as the code "for 1b.11" to reuse.
--
-- SECURITY: enforce_dc_only_numbering() stays SECURITY INVOKER (unchanged —
-- it already reads only dcs.dictionaries, world-readable to authenticated,
-- and public.is_doc_controller() / public.is_admin(), both SECURITY DEFINER
-- already). enforce_document_void() and the two new INSERT-guard functions
-- are SECURITY INVOKER too, for the same reason — they read dcs.dictionaries
-- and the row being written, nothing the caller's own RLS could hide from
-- them. EXECUTE is revoked from every API role on all three (advisor 0029 —
-- trigger functions, checked at CREATE TRIGGER, not at execution, so the
-- baseline of 12 does not move).

-- ==================================================================
-- 1. Columns.
-- ==================================================================
alter table dcs.documents
  add column void_reason text,
  add column void_at timestamptz;

comment on column dcs.documents.void_reason is
  'Why the document was Voided. Mandatory whenever workflow_status_id is '
  'VOID (23514 otherwise, and 23514 if set while the status is NOT VOID); '
  'frozen once VOID (23001 on any change while it stays VOID). Writable only '
  'by that project''s DC in an aal2 session, like workflow_status_id itself '
  '(trigger documents_workflow_status_dc_only, DCS 1b.11).';

comment on column dcs.documents.void_at is
  'When the document was Voided. Owned entirely by the trigger '
  '(enforce_document_void): stamped on the transition into VOID, carried '
  'over unchanged otherwise, and any client-supplied value is ignored, not '
  'validated. Frozen once VOID (23001 on any change while it stays VOID). '
  'NOT cleared when an admin moves the document off VOID — 1b.11 decides '
  'nothing about that; see docs/deferred-tasks.md.';

-- ==================================================================
-- 2. enforce_dc_only_numbering(): one scoped admin escape, one format fix.
--    CREATE OR REPLACE — every existing trigger call site passes plain
--    column names, so v_admin_ok is false for every one of them and their
--    behaviour is byte-for-byte what it was on main (checked by the trigger
--    reference tests below, which pin the six pre-existing trigger
--    definitions unchanged).
-- ==================================================================
create or replace function public.enforce_dc_only_numbering() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new);
  v_col text;
  v_real_col text;
  v_admin_ok boolean;
  v_before jsonb;
  v_verb text := case when tg_op = 'INSERT' then 'set' else 'changed' end;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  foreach v_col in array tg_argv loop
    -- An argument prefixed 'admin:' names a column an admin
    -- (public.is_admin()) may also change, in an aal2 session, in addition
    -- to the project's DC — today only workflow_status_id, so an admin can
    -- move a document off VOID (DCS 1b.11 decision 4). Every pre-existing
    -- caller of this function passes plain column names, so v_admin_ok is
    -- false for them and nothing about their behaviour changes.
    v_admin_ok := v_col like 'admin:%';
    v_real_col := case when v_admin_ok then substring(v_col from 7) else v_col end;
    v_before := case when tg_op = 'UPDATE' then v_old -> v_real_col else 'null'::jsonb end;

    if v_before is distinct from (v_new -> v_real_col) then
      if not public.is_doc_controller(new.project_id)
         and not (v_admin_ok and public.is_admin())
      then
        raise exception
          '%.%.% may be % only by the Document Controller of this project (dcs.project_roles role ''dc'')%. Caller: %.',
          tg_table_schema, tg_table_name, v_real_col, v_verb,
          case when v_admin_ok then ' or an admin' else '' end,
          coalesce(auth.uid()::text, '<no session>')
          using errcode = 'insufficient_privilege';
      end if;
      if ((select auth.jwt()) ->> 'aal') is distinct from 'aal2' then
        raise exception
          '%.%.% may be % only in a session with a verified second factor (aal2). Current assurance level: %.',
          tg_table_schema, tg_table_name, v_real_col, v_verb,
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
  'them is supplied at all. An argument prefixed ''admin:'' also admits an '
  'admin (public.is_admin()), still only at aal2 (DCS 1b.11) — used today '
  'only for workflow_status_id, so an admin can move a document off VOID. RLS '
  'cannot express the UPDATE half — a policy sees either the old row (USING) '
  'or the new one (WITH CHECK), never both — and cannot express the INSERT '
  'half either, because the INSERT policies decide who may create the row, '
  'not which columns they may fill, and column-level GRANTs are per role, not '
  'per project. Sessionless callers (migration, seed, psql, service_role) '
  'pass — they bypass RLS on this table anyway.';

-- CREATE OR REPLACE keeps the ACL this function already has, so this is a
-- re-statement rather than a repair (same reasoning as 1b.03).
revoke execute on function public.enforce_dc_only_numbering()
  from public, anon, authenticated, service_role;

-- ==================================================================
-- 3. The two new DC-only status guards. WHEN (pg_trigger_depth() = 0): see
--    decision 2 above. revisions_numbering_dc_only (scl_revision /
--    cpy_revision) is NOT touched.
-- ==================================================================
create trigger documents_workflow_status_dc_only
  before update on dcs.documents
  for each row
  when (pg_trigger_depth() = 0)
  execute function public.enforce_dc_only_numbering('admin:workflow_status_id', 'void_reason');

create trigger revisions_status_dc_only
  before update on dcs.revisions
  for each row
  when (pg_trigger_depth() = 0)
  execute function public.enforce_dc_only_numbering('status_id');

-- ==================================================================
-- 4. INSERT-time status guards (decision 5). New functions — the existing
--    ones are not touched. Neither needs a WHEN clause: nothing in this
--    schema cascades an INSERT into dcs.documents or dcs.revisions from
--    inside another trigger (promote_new_revision only UPDATEs), matching
--    every other INSERT-time trigger on these two tables.
-- ==================================================================
create function public.enforce_document_insert_status() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  select d.code into v_code from dcs.dictionaries d where d.id = new.workflow_status_id;

  if v_code = 'NOT_STARTED' then
    return new;
  end if;

  if not public.is_doc_controller(new.project_id) then
    raise exception
      'dcs.documents.workflow_status_id may be set to anything other than NOT_STARTED at insert only by the Document Controller of this project (dcs.project_roles role ''dc''). Caller: %.',
      coalesce(auth.uid()::text, '<no session>')
      using errcode = 'insufficient_privilege';
  end if;
  if ((select auth.jwt()) ->> 'aal') is distinct from 'aal2' then
    raise exception
      'dcs.documents.workflow_status_id may be set to anything other than NOT_STARTED at insert only in a session with a verified second factor (aal2). Current assurance level: %.',
      coalesce(((select auth.jwt()) ->> 'aal'), '<no session>')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

comment on function public.enforce_document_insert_status() is
  'BEFORE INSERT row trigger for dcs.documents: a non-DC caller may only '
  'insert with workflow_status NOT_STARTED (42501 otherwise). Closes the gap '
  'left by enforce_dc_only_numbering(''admin:workflow_status_id'', ...), '
  'which is UPDATE-only. Sessionless callers and dcs.import_mode = ''on'' '
  'pass, as elsewhere in this schema (DCS 1b.11).';

revoke execute on function public.enforce_document_insert_status()
  from public, anon, authenticated, service_role;

create trigger documents_insert_status_dc_only
  before insert on dcs.documents
  for each row execute function public.enforce_document_insert_status();

create function public.enforce_revision_insert_status() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_step_code   text;
  v_status_code text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  select d.code into v_step_code from dcs.dictionaries d where d.id = new.step_id;
  select d.code into v_status_code from dcs.dictionaries d where d.id = new.status_id;

  if v_status_code is not distinct from v_step_code then
    return new;
  end if;

  if not public.is_doc_controller(new.project_id) then
    raise exception
      'dcs.revisions.status_id must match the step (got step %, status %) unless set by the Document Controller of this project (dcs.project_roles role ''dc''). Caller: %.',
      coalesce(v_step_code, '<unknown step>'), coalesce(v_status_code, '<unknown status>'),
      coalesce(auth.uid()::text, '<no session>')
      using errcode = 'insufficient_privilege';
  end if;
  if ((select auth.jwt()) ->> 'aal') is distinct from 'aal2' then
    raise exception
      'dcs.revisions.status_id must match the step (got step %, status %) unless set in a session with a verified second factor (aal2). Current assurance level: %.',
      coalesce(v_step_code, '<unknown step>'), coalesce(v_status_code, '<unknown status>'),
      coalesce(((select auth.jwt()) ->> 'aal'), '<no session>')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

comment on function public.enforce_revision_insert_status() is
  'BEFORE INSERT row trigger for dcs.revisions: a non-DC caller may only '
  'insert with status_id whose CODE equals step_id''s (42501 otherwise) — '
  'the same rule lib/revisions.ts already follows when it resolves status '
  'from the chosen step (DCS 1b.08), now enforced in the database. Does NOT '
  'restrict which step a non-DC caller may choose — that stays app policy '
  '(REVISION_STEP_CODES, DCS 1b.08), out of scope here. Sessionless callers '
  'and dcs.import_mode = ''on'' pass (DCS 1b.11).';

revoke execute on function public.enforce_revision_insert_status()
  from public, anon, authenticated, service_role;

create trigger revisions_insert_status_dc_only
  before insert on dcs.revisions
  for each row execute function public.enforce_revision_insert_status();

-- ==================================================================
-- 5. Void: void_reason mandatory and frozen, void_at trigger-owned, leaving
--    VOID admin-only (decisions 3, 4, 6).
-- ==================================================================
create function public.enforce_document_void() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_status_code     text;
  v_old_status_code text;
begin
  if coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  select d.code into v_status_code
    from dcs.dictionaries d
   where d.id = new.workflow_status_id;

  if tg_op = 'UPDATE' then
    select d.code into v_old_status_code
      from dcs.dictionaries d
     where d.id = old.workflow_status_id;
  end if;

  -- Leaving VOID: admin only. documents_workflow_status_dc_only (above)
  -- already checked WHO may change workflow_status_id at all (DC at aal2, or
  -- admin at aal2 for this one column); this is the narrower question of
  -- leaving VOID specifically, so it is checked again here, against the
  -- state this trigger already reads.
  if tg_op = 'UPDATE'
     and v_old_status_code = 'VOID'
     and v_status_code is distinct from 'VOID'
     and not public.is_admin()
  then
    raise exception
      'dcs.documents: document % is Void; its status may be changed away from VOID only by an admin. Void is irreversible in ordinary use — to continue the work, create a new document.',
      new.id
      using errcode = 'restrict_violation';
  end if;

  -- Staying VOID: void_reason and void_at are frozen for everyone, admin
  -- included — refused, not silently coerced.
  if v_old_status_code = 'VOID' and v_status_code = 'VOID' then
    if new.void_reason is distinct from old.void_reason then
      raise exception
        'dcs.documents.void_reason cannot be changed while the document stays Void (document %).',
        new.id
        using errcode = 'restrict_violation';
    end if;
    new.void_at := old.void_at;
    return new;
  end if;

  -- Entering VOID: reason mandatory; void_at is trigger-owned, stamped here.
  if v_status_code = 'VOID' then
    if btrim(coalesce(new.void_reason, '')) = '' then
      raise exception
        'dcs.documents.void_reason is required and must not be blank whenever workflow status is VOID (document %).',
        new.id
        using errcode = 'check_violation';
    end if;
    new.void_at := now();
    return new;
  end if;

  -- Not VOID (never was, or just left it under the admin exception above):
  -- void_reason may not be introduced or changed outside a Void action, but
  -- the stale value an admin's leaving-VOID update carries over untouched is
  -- not a "change" (new = old on UPDATE, since it was not in the SET list),
  -- so it passes — 1b.11 decides nothing about clearing it (decision 6).
  if tg_op = 'UPDATE' then
    if new.void_reason is distinct from old.void_reason then
      raise exception
        'dcs.documents.void_reason can be set only when the document''s status is VOID (document %).',
        new.id
        using errcode = 'check_violation';
    end if;
    new.void_at := old.void_at;
  else
    if btrim(coalesce(new.void_reason, '')) <> '' then
      raise exception
        'dcs.documents.void_reason can be set only when the document''s status is VOID (document %).',
        new.id
        using errcode = 'check_violation';
    end if;
    new.void_at := null;
  end if;

  return new;
end;
$$;

comment on function public.enforce_document_void() is
  'BEFORE INSERT OR UPDATE row trigger for dcs.documents. Leaving VOID needs '
  'public.is_admin() (23001 otherwise — decision 4). While VOID, void_reason '
  'is mandatory (23514) and, together with void_at, frozen against any '
  'further change (23001). void_at is owned by the trigger, never the '
  'caller: stamped now() on the transition into VOID, carried over '
  'unchanged otherwise, any client-supplied value ignored. void_reason may '
  'not be set while the status is not VOID (23514). dcs.import_mode = ''on'' '
  'bypasses the whole function (historical Void rows). Fires after '
  'documents_workflow_status_dc_only / documents_insert_status_dc_only — '
  'name order — so authorization is decided before state consistency '
  '(DCS 1b.11).';

revoke execute on function public.enforce_document_void()
  from public, anon, authenticated, service_role;

create trigger documents_workflow_status_void_reason
  before insert or update on dcs.documents
  for each row execute function public.enforce_document_void();
