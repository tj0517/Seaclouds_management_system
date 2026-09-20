-- DCS 1b.08, part 3 of 3: a new revision becomes the document's current one.
--
-- documents.current_revision_id, the document's NOT_STARTED -> STARTED move and
-- the status of the revision that was current before are all derived from one
-- event — a revision being inserted — so they are done in the database by one
-- AFTER INSERT trigger, not by the dialog. A front-end that did the three
-- writes as separate requests could leave a document pointing at a revision
-- that is not the newest, or two revisions both un-superseded, and nothing
-- downstream (v_mdr, the profile) could tell.
--
-- On each INSERT into dcs.revisions the trigger:
--   1. locks the document row (serialises two revisions on one document),
--   2. sets documents.current_revision_id to the new revision,
--   3. moves the document from NOT_STARTED to STARTED — and from nothing else:
--      any other status is left exactly as it is (manual status changes are
--      1b.11, not this task),
--   4. marks the revision that WAS current SUPERSEDED, when there was one.
--
-- The new revision keeps the status it was inserted with. Choosing it is the
-- dialog's job: the workflow_status row whose code equals the chosen step's
-- (decision 7 of this task), so an IFR revision is inserted as IFR.
--
-- SECURITY DEFINER. This is bookkeeping derived from an insert the caller was
-- already allowed to make, not a second thing the caller does, so it should
-- not depend on the caller also holding UPDATE on dcs.documents and
-- dcs.revisions — and a row an invoker's policy hid would be a silent no-op
-- UPDATE, which is the failure direction that matters (a stale current
-- revision, no error). The set of roles that may INSERT a revision and the set
-- that may UPDATE one are identical today (admin, an ORIG, a DC at aal2), so
-- this changes nothing that is reachable now; it keeps that from depending on
-- the two staying equal. audit_trigger() reads auth.uid(), not the current
-- role, so every write below is still attributed to the signed-in user.
-- EXECUTE is revoked from every API role: it is a trigger function, and lint
-- 0029 counts only definers an API role can execute.
--
-- WHAT PROVES THIS, AND WHAT DOES NOT. supabase/tests/revision_promotion.test.sql
-- proves the behaviour on one connection. It cannot prove the two things that
-- only show up with real parallel sessions, and both were found the hard way
-- while this migration was being written (full reasons at the locking SELECT
-- below): `python3 scripts/revision-proofs.py concurrency` runs them — three
-- sessions at once on one document, with the lock (one live revision, always the
-- current one) and with it removed (seven live revisions out of nine) — and
-- `... red` breaks each control on purpose and shows its test go red. Re-run
-- them before touching this function; they are not in CI.
--
-- ONE GUARD IS ONLY A SHAPE ASSERTION, and whoever changes the roles should know
-- it: the SECURITY DEFINER choice above is protected by a test that reads
-- pg_proc.prosecdef, not by a behavioural one. Today no test can tell definer
-- from invoker, because the roles that may INSERT a revision and the roles that
-- may UPDATE one are identical (admin, an ORIG, a DC at aal2), so an invoker
-- version would behave exactly the same. The day those two sets are split — say
-- an ORIG may create a revision but no longer edit the document — the
-- invoker version would silently stop moving the document and superseding the
-- previous revision, and revision_promotion.test.sql would not notice: its
-- behavioural cases would need a caller who can insert and cannot update.
-- Add that caller to the test in the same change that splits the roles.
--
-- Not done here, and named so it is a decision on the record:
--   * the final-revision lock (1b.10). When it lands it must let this trigger
--     through: marking an IFC/IFI/IFB revision SUPERSEDED is a change to a
--     locked row, and it is the one the system itself makes.
--   * a guard on which documents may carry the SUPERSEDED status. It is a
--     revision status; nothing stops a document row being given it through the
--     API. Manual status changes are 1b.11.
--   * an edge that IS reachable: if the previous current revision carries a
--     cpy_revision and the project has since turned cpy_numbering off, the
--     UPDATE below is refused by revisions_cpy_numbering (23514) and so is the
--     new revision. The same trigger already refuses every other edit of that
--     row today. Recorded in docs/deferred-tasks.md.
create function public.promote_new_revision() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_previous    uuid;
  v_status_id   uuid;
  v_status_code text;
  v_started     uuid;
  v_superseded  uuid;
begin
  -- The row lock is the serialisation point: a second revision on the same
  -- document waits here until this transaction commits, then reads the
  -- current_revision_id this one wrote.
  --
  -- NO KEY UPDATE, not UPDATE — and this is not a style choice. The INSERT's own
  -- foreign-key check (document_id, project_id) -> documents already holds
  -- FOR KEY SHARE on this row. Two concurrent revisions on one document each
  -- hold that, and each then asks for FOR UPDATE, which conflicts with the
  -- other's key share: a deadlock, measured with three parallel inserts and no
  -- artificial delay (Postgres aborts one of them with "deadlock detected").
  -- FOR NO KEY UPDATE conflicts with itself, so the two revisions still queue,
  -- but not with a key share, so neither waits on the other's FK check. The
  -- UPDATE below touches no key column, so it takes the same mode.
  --
  -- The locking SELECT reads dcs.documents ALONE, and the status code is looked
  -- up afterwards. A join here is a second bug, also measured: a session that
  -- waits on the lock re-checks the row against the version the winner wrote,
  -- and the winner has just changed workflow_status_id (NOT_STARTED -> STARTED),
  -- so a join on it no longer matches the row the plan had already paired it
  -- with — the row silently drops out and the loser reports "no document".
  select d.current_revision_id, d.workflow_status_id
    into v_previous, v_status_id
    from dcs.documents d
   where d.id = new.document_id
     for no key update;

  if not found then
    -- Cannot happen while the composite foreign key exists; stated so that a
    -- future change to it fails here, loudly, and not as a silent no-op.
    raise exception
      'dcs.revisions: revision % has no document % to become current on.',
      new.id, new.document_id;
  end if;

  select d.code into v_status_code
    from dcs.dictionaries d
   where d.id = v_status_id;

  -- 4. The revision that was current stops being. Looked up by code, and
  --    raised when the row is missing: a DC can delete an unused dictionary
  --    row through the 1a.15 screen (O-15, docs/deferred-tasks.md oo), and the
  --    alternative to a named error is a document with two live revisions.
  if v_previous is not null and v_previous <> new.id then
    select d.id into v_superseded
      from dcs.dictionaries d
     where d.dict_type = 'workflow_status' and d.code = 'SUPERSEDED';
    if v_superseded is null then
      raise exception
        'dcs.revisions: workflow_status SUPERSEDED is missing from dcs.dictionaries, so revision % cannot be marked as replaced. Restore the row (code SUPERSEDED, dict_type workflow_status) — the system needs it and it is not a DC choice.',
        v_previous;
    end if;
    update dcs.revisions
       set status_id = v_superseded
     where id = v_previous
       and status_id <> v_superseded;
  end if;

  -- 3. NOT_STARTED -> STARTED, and only that.
  if v_status_code = 'NOT_STARTED' then
    select d.id into v_started
      from dcs.dictionaries d
     where d.dict_type = 'workflow_status' and d.code = 'STARTED';
    if v_started is null then
      raise exception
        'dcs.revisions: workflow_status STARTED is missing from dcs.dictionaries, so document % cannot leave NOT_STARTED.',
        new.document_id;
    end if;
  end if;

  -- 2. (+ 3.) One UPDATE, so the document is audited once with both changes.
  update dcs.documents
     set current_revision_id = new.id,
         workflow_status_id  = coalesce(v_started, workflow_status_id)
   where id = new.document_id;

  return new;
end;
$$;

comment on function public.promote_new_revision() is
  'AFTER INSERT row trigger for dcs.revisions. Makes the new revision the '
  'document''s current_revision_id; moves the document NOT_STARTED -> STARTED '
  '(no other status is touched); marks the previously current revision '
  'SUPERSEDED. Locks the document row first, so two revisions on one document '
  'are applied in order. SECURITY DEFINER: derived bookkeeping that must not '
  'depend on the inserting caller also holding UPDATE, and must not degrade to '
  'a silent no-op under RLS (DCS 1b.08).';

revoke execute on function public.promote_new_revision()
  from public, anon, authenticated, service_role;

-- AFTER, so the composite foreign key (id, current_revision_id) ->
-- revisions (document_id, id) sees the row it points at, and after
-- audit_revisions (AFTER triggers fire in name order: audit_revisions <
-- revisions_promote_current), so the audit log reads insert first, then the
-- supersede and the document update it caused.
create trigger revisions_promote_current
  after insert on dcs.revisions
  for each row execute function public.promote_new_revision();

comment on column dcs.documents.current_revision_id is
  'The document''s current revision. Set by the database: trigger '
  'revisions_promote_current points it at each new revision as it is inserted '
  '(DCS 1b.08). The composite foreign key (id, current_revision_id) -> '
  'revisions (document_id, id) makes it a revision of THIS document.';
