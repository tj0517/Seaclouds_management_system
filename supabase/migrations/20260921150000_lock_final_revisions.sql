-- DCS 1b.10: the files of an approved final revision (IFC / IFI / IFB) are
-- immutable, and the database enforces it (brief §3.5) — not the front-end, so
-- nobody gets around it through the API.
--
-- There is no "Approved" status: revisions.status_id points at workflow_status
-- and a new revision is inserted with the status of its step. "Approved" is
-- therefore an explicit column, dcs.revisions.locked_at. In Phase 1 the DC sets
-- it (the button is 1b.11); in Phase 2 the workflow engine will set the same
-- field. Once it is set, the revision and its files are frozen — the one change
-- allowed is the system's own move to SUPERSEDED when a newer revision arrives.
--
-- Decided with the owner before this migration was written (2026-09-21):
--   (a) WHO SETS locked_at: only the project's DC in an aal2 session. Not an
--       Originator (the "Originators update revisions" policy would otherwise
--       let one freeze their own revision), not an admin who holds no dc role.
--       No new function: the existing enforce_dc_only_numbering() is attached a
--       second and third time with 'locked_at' as its argument, for INSERT and
--       for UPDATE — the same rule, the same aal2 test, the same bypass for a
--       session-less caller (migration, psql, service_role) as for numbering.
--       For Phase 2: a workflow engine that sets locked_at inside a USER session
--       is judged as that user, so it must either run session-less or act for a
--       DC at aal2.
--   (b) UNLOCKING: never. No trigger branch clears locked_at, for anyone. A
--       revision locked by mistake is corrected by a new revision; the
--       break-glass is the table owner disabling these triggers in a migration
--       or a psql session — a deliberate, visible act. Loosening the rule later
--       is an ordinary migration; tightening it after the fact is not, which is
--       why it ships in the strict form.
--   (c) DELETE: only an admin (FOR ALL) has a DELETE policy on dcs.revisions
--       and dcs.files. An Originator or DC DELETE is hidden by RLS — 0 rows —
--       and never reaches the row triggers below. The tests say so.
--
-- What the triggers do.
--   dcs.files       BEFORE INSERT / UPDATE / DELETE: refused when the target
--                   revision has locked_at set (UPDATE: OLD and NEW revision
--                   both). Applies to every caller, admin and service_role
--                   included — locked_at is a fact about the revision, not an
--                   authorization question.
--   dcs.revisions   BEFORE UPDATE: on a locked row the only change allowed is
--                   status_id -> SUPERSEDED, and only when another revision of
--                   the same document with a later created_at exists (updated_at
--                   is set_updated_at's, which fires after). Clearing or changing locked_at is a
--                   change like any other. BEFORE DELETE: refused.
--                   BEFORE INSERT / UPDATE: locked_at may be non-NULL only on a
--                   revision whose step is IFC, IFI or IFB (a CHECK cannot look
--                   in another table). Step codes are immutable
--                   (dictionaries_code_immutable), so the rule cannot drift.
--
-- Cascades. files and revisions both cascade from their parent, and a cascade
-- fires the row triggers. A locked revision therefore also blocks deleting its
-- document and its project. That is the intent (Void, not delete) but it is a
-- fact operators will meet, so it is named here and in docs/02-data-model.md.
--
-- Import bypass: with dcs.import_mode = 'on' an INSERT or UPDATE passes the two
-- lock triggers (same pattern as refuse_revision_on_void_document — historical
-- IFC rows arrive with their files and their lock). DELETE is refused even
-- then. The locked_at -> final-step rule is NOT lifted by import_mode: it is a
-- fact about the row, and the import has no reason to break it.
--
-- promote_new_revision() is NOT changed. Its UPDATE of the previous current
-- revision (status_id -> SUPERSEDED, run as the definer) goes through
-- forbid_change_of_locked_revision() like any other write and is the one it lets
-- through — because the new revision it was called for is already there and
-- newer; a hand-made SUPERSEDED with no newer revision is refused. Proven in supabase/tests/final_revision_lock.test.sql.
--
-- SQLSTATE: restrict_violation (23001) for every refusal of a change to a locked
-- revision or its files — one recognisable code for 1b.11 to map to a sentence,
-- distinct from the 42501 / 23514 / 23503 / 23502 this schema already uses.
-- 42501 (from enforce_dc_only_numbering) for "you may not set locked_at",
-- 23514 for "not a final step".
--
-- SECURITY DEFINER with search_path '' on the two lock functions: the failure
-- direction matters. As an invoker, a revision the caller's policies hide would
-- read as "not locked" and the write would pass. EXECUTE is revoked from every
-- API role on all three (lint 0028 / 0029, as for every trigger function here).
--
-- Named, and deliberately not done here:
--   * The bytes in storage.objects. No UPDATE or DELETE policy exists for
--     dcs-documents (1b.09), so no API role can touch them, but service_role
--     bypasses RLS and no trigger on storage.objects is added here (out of
--     scope). "Immutable" covers the index and the revision, not the bytes
--     against the service key. Recorded in docs/deferred-tasks.md.
--   * A race the row triggers alone would leave open, closed below with FOR
--     SHARE (see forbid_change_of_locked_file). A single-transaction pgTAP file
--     cannot prove it; scripts/revision-proofs.py is where a concurrent proof
--     lives.

alter table dcs.revisions
  add column locked_at timestamptz;

comment on column dcs.revisions.locked_at is
  'Set when a final revision (step IFC / IFI / IFB) is approved: from then on '
  'the revision and its dcs.files rows are immutable, enforced by triggers '
  '(DCS 1b.10). NULL = not locked. Non-NULL only on a final step (23514 '
  'otherwise). Settable only by the project''s DC in an aal2 session (42501 '
  'otherwise; session-less callers pass). Never cleared: no trigger branch '
  'unlocks, for anyone. The only change a locked row accepts is status_id -> '
  'SUPERSEDED, made by promote_new_revision() when a newer revision is added.';

-- ------------------------------------------------------------------
-- 1. locked_at only on a final step.
-- ------------------------------------------------------------------
create function public.enforce_locked_at_final_step() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_step_code text;
begin
  if new.locked_at is null then
    return new;
  end if;

  select d.code into v_step_code
    from dcs.dictionaries d
   where d.id = new.step_id;

  if v_step_code is null or v_step_code not in ('IFC', 'IFI', 'IFB') then
    raise exception
      'dcs.revisions.locked_at can be set only on a final revision (step IFC, IFI or IFB); revision % is on step %.',
      new.id, coalesce(v_step_code, '<unknown step>')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_locked_at_final_step() is
  'BEFORE INSERT OR UPDATE row trigger for dcs.revisions: raises 23514 when '
  'locked_at is non-NULL and the revision''s step is not IFC, IFI or IFB. Not '
  'lifted by dcs.import_mode. SECURITY DEFINER so the step is read from '
  'dcs.dictionaries whatever the caller may see (DCS 1b.10).';

revoke execute on function public.enforce_locked_at_final_step()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. A locked revision changes in one way only, and is never deleted.
-- ------------------------------------------------------------------
create function public.forbid_change_of_locked_revision() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_superseded uuid;
begin
  if old.locked_at is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'dcs.revisions: revision % is locked (locked_at %) and cannot be deleted. A final revision is kept as issued; to correct it, add a new revision.',
      old.id, old.locked_at
      using errcode = 'restrict_violation';
  end if;

  -- UPDATE. Historical final revisions arrive with their lock (SMDR import).
  if coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  -- The one change the system itself makes: promote_new_revision() marks the
  -- previous current revision SUPERSEDED. Every other column, locked_at
  -- included, must be exactly as it was. The comparison is over the whole row
  -- so a column added later is frozen without anyone remembering to list it.
  -- Left out: status_id (compared separately), updated_at (set_updated_at
  -- overwrites it after this trigger anyway) and the three GENERATED columns
  -- (constant expressions of the table definition, and Postgres has not
  -- computed them yet in a BEFORE trigger, so NEW carries no value to compare).
  select d.id into v_superseded
    from dcs.dictionaries d
   where d.dict_type = 'workflow_status' and d.code = 'SUPERSEDED';

  if new.status_id is not distinct from v_superseded
     and old.status_id is distinct from v_superseded
     and (to_jsonb(new) - 'status_id' - 'updated_at'
            - 'step_dict_type' - 'acceptance_code_dict_type' - 'status_dict_type')
         = (to_jsonb(old) - 'status_id' - 'updated_at'
            - 'step_dict_type' - 'acceptance_code_dict_type' - 'status_dict_type')
  then
    -- Only ever in favour of a newer revision. "Newer" is created_at, the order
    -- the Revisions tab already uses, and NOT documents.current_revision_id:
    -- promote_new_revision() marks the old revision SUPERSEDED (its
    -- `update dcs.revisions set status_id = v_superseded`) BEFORE it moves
    -- current_revision_id (its later `update dcs.documents`), so when this
    -- trigger fires for that UPDATE the pointer still names the OLD revision.
    -- The new revision is already inserted then (AFTER INSERT) and visible here.
    -- Without this condition anyone who may UPDATE the row could supersede a
    -- locked revision by hand with nothing to replace it. A revision inserted
    -- with an explicit created_at older than the one it replaces cannot supersede
    -- it either — the INSERT is refused, which is the intent, not a side effect.
    if exists (
      select 1
        from dcs.revisions n
       where n.document_id = old.document_id
         and n.id <> old.id
         and n.created_at > old.created_at
    ) then
      return new;
    end if;

    raise exception
      'dcs.revisions: revision % is locked (locked_at %) and cannot be marked SUPERSEDED, because document % has no newer revision to replace it. The system does that itself when a newer revision is added.',
      old.id, old.locked_at, old.document_id
      using errcode = 'restrict_violation';
  end if;

  raise exception
    'dcs.revisions: revision % is locked (locked_at %); the only change it accepts is status -> SUPERSEDED, made when a newer revision is added. locked_at itself cannot be changed or cleared. To correct a final revision, add a new revision.',
    old.id, old.locked_at
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.forbid_change_of_locked_revision() is
  'BEFORE UPDATE OR DELETE row trigger for dcs.revisions. A row with locked_at '
  'set cannot be deleted (23001), and its UPDATE is refused (23001) unless the '
  'only change is status_id -> the SUPERSEDED workflow_status row AND another '
  'revision of the same document with a later created_at exists, or the '
  'session set dcs.import_mode = ''on'' (UPDATE only; DELETE is refused '
  'always). Applies to every caller. SECURITY DEFINER so a locked revision the '
  'caller cannot see is still locked (DCS 1b.10).';

revoke execute on function public.forbid_change_of_locked_revision()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 3. The files of a locked revision.
-- ------------------------------------------------------------------
create function public.forbid_change_of_locked_file() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_ids uuid[];
  v_rev record;
begin
  if tg_op <> 'DELETE'
     and coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  -- UPDATE checks both ends: a file may not be moved out of a locked revision
  -- or into one.
  v_ids := case tg_op
             when 'INSERT' then array[new.revision_id]
             when 'UPDATE' then array[old.revision_id, new.revision_id]
             else array[old.revision_id]
           end;

  -- FOR SHARE, and on every candidate row, not only on a locked one. The
  -- INSERT's own foreign-key check holds FOR KEY SHARE on the revision, and the
  -- lock is set by an UPDATE of a non-key column (FOR NO KEY UPDATE) — the two
  -- do not conflict, so without this a file written while the DC locks the
  -- revision could commit inside it. FOR SHARE conflicts with NO KEY UPDATE: the
  -- later of the two waits for the earlier to finish and, in READ COMMITTED,
  -- reads the row as the winner left it. ORDER BY id so an UPDATE that touches
  -- two revisions always takes the locks in the same order.
  for v_rev in
    select r.id, r.locked_at
      from dcs.revisions r
     where r.id = any (v_ids)
     order by r.id
       for share of r
  loop
    if v_rev.locked_at is not null then
      raise exception
        'dcs.files: % refused — revision % is locked (locked_at %). The files of an approved final revision (IFC / IFI / IFB) are immutable. To correct it, add a new revision.',
        tg_op, v_rev.id, v_rev.locked_at
        using errcode = 'restrict_violation';
    end if;
  end loop;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function public.forbid_change_of_locked_file() is
  'BEFORE INSERT OR UPDATE OR DELETE row trigger for dcs.files: raises 23001 '
  'when the file''s revision (UPDATE: old or new) has locked_at set, for every '
  'caller including admin and service_role. dcs.import_mode = ''on'' lets '
  'INSERT and UPDATE through; DELETE is refused always. Takes FOR SHARE on the '
  'revision row so a concurrent lock and file write are serialised. SECURITY '
  'DEFINER so a locked revision the caller cannot see is still locked '
  '(DCS 1b.10).';

revoke execute on function public.forbid_change_of_locked_file()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 4. Triggers. BEFORE triggers fire in name order, and every one of these sorts
--    before set_updated_at, so a refused write leaves neither an updated_at
--    bump nor an audit_log row. revisions_assert_not_locked sorts before
--    revisions_cpy_numbering, so a change to a locked row is reported as
--    "locked", not as whichever numbering rule it also happens to break.
-- ------------------------------------------------------------------
create trigger revisions_assert_not_locked
  before update or delete on dcs.revisions
  for each row execute function public.forbid_change_of_locked_revision();

create trigger revisions_locked_at_dc_only
  before update on dcs.revisions
  for each row execute function public.enforce_dc_only_numbering('locked_at');

create trigger revisions_locked_at_dc_only_insert
  before insert on dcs.revisions
  for each row execute function public.enforce_dc_only_numbering('locked_at');

create trigger revisions_locked_at_final_step
  before insert or update on dcs.revisions
  for each row execute function public.enforce_locked_at_final_step();

create trigger files_assert_revision_not_locked
  before insert or update or delete on dcs.files
  for each row execute function public.forbid_change_of_locked_file();

-- ------------------------------------------------------------------
-- 5. The two table comments that pointed at this task.
-- ------------------------------------------------------------------
comment on table dcs.revisions is
  'One issue of a document (brief §5.4): its step, dates, acceptance code and '
  'files. scl_revision is unique within the document. A final revision '
  '(IFC/IFI/IFB) with locked_at set is immutable — the row and its files — '
  'enforced by triggers, for every caller (DCS 1b.10).';

comment on table dcs.files is
  'Files of one revision (brief §5.5). The bytes live in Supabase Storage '
  '(bucket dcs-documents, first path segment = projects.project_code, '
  '1b.09) and are reachable only through signed URLs; this table is the '
  'index. file_name is the generated name '
  '([SCL_DOC_NUMBER]_[REV]_[STEP]_[YYYY-MM-DD]_[NN].[ext]), original_name '
  'the uploaded one, storage_path the object key — all three NOT NULL since '
  '1b.09. No INSERT, UPDATE or DELETE while the revision has locked_at set '
  '(trigger files_assert_revision_not_locked, 1b.10).';
