-- DCS 1b.08, part 2 of 3: the SCL revision-number generator, and the two
-- BEFORE INSERT guards on dcs.revisions that go with it.
--
-- dcs.revisions.scl_revision is NOT NULL and UNIQUE per document, and until
-- now nothing decided its value: any text passed (docs/deferred-tasks.md pp).
-- The shape 1b.02 gave scl_doc_number is copied here — a function that
-- computes it, a BEFORE INSERT trigger that fills it, and a refusal of a
-- hand-typed one — because CLAUDE.md is explicit that a manual SCL number must
-- be impossible in every form and action.
--
--   * dcs.next_revision_code(document, step) proposes the next code,
--   * revisions_assign_scl_revision fills scl_revision when it is NULL and
--     accepts a supplied one only from the project's Document Controller in an
--     aal2 session (checked against the step's series), refusing everyone else
--     with 42501 — plus the two exceptions below (import_mode, no session),
--   * revisions_refuse_void_document refuses a revision on a Void document.
--
-- Migration 3 (revisions_promote_current) keeps the document's current
-- revision, its NOT_STARTED -> STARTED move and the SUPERSEDED marking in step
-- with what these two let through.
--
-- What proves the locks: pgTAP runs on one connection and cannot race itself, so
-- the advisory lock below is asserted in supabase/tests/scl_revision_generator.test.sql
-- as text in the function body only. The proof that it holds is
-- `python3 scripts/revision-proofs.py concurrency` (twelve parallel sessions on one
-- document: codes 1..12 with the lock, eleven UNIQUE failures with it removed) and
-- `... red` (every control broken on purpose, its test turned red). Neither is in
-- CI; re-run them before changing this file. The same script found the two bugs
-- in revisions_promote_current, which are explained at the locking SELECT there.
--
-- ------------------------------------------------------------------
-- The series (brief §6.5, docs/00-glossary.md)
-- ------------------------------------------------------------------
--   IDC                 A, B, C …    letters, A..Z
--   IFR                 00, 01 …     two digits, 00..99
--   IFC / IFI / IFB     1, 2, 3 …    ONE shared counter across the three
--
-- "Count per series format": the finals share one counter because §6.5 writes
-- them as a single series ("1 first issue, 2 re-issue"). Counting per step
-- instead would give an IFC 1 and then an IFI 1 on the same document, and
-- UNIQUE (document_id, scl_revision) would refuse the second.
--
-- The counter for a series is the highest code already used BY THAT SERIES'
-- STEPS on this document, plus one. It reads step_id as well as the value: a
-- final revision "10" and an IFR "10" are both two digits, and only the step
-- says which series a row belongs to. A stored value that does not fit its
-- series' shape (a historical revision the import carried in another format)
-- contributes nothing — the same leniency 1b.02 has, with the same backstop:
-- the UNIQUE constraint makes a clash a loud 23505, never a silent duplicate.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (1-3 and 5 confirmed with the owner before it
-- was written; 4 and 6 were chosen here and are flagged in the PR)
-- ------------------------------------------------------------------
-- 1. RETCOM HAS NO SERIES, ON PURPOSE. Not an oversight. RETCOM is the client
--    returning a document, not SCL issuing one: in the register it carries the
--    same number as the IFR revision it returns, which UNIQUE (document_id,
--    scl_revision) cannot hold, and Phase 1 has no workflow engine from which
--    a better number could be derived. So next_revision_code raises a named
--    error for it and the trigger refuses a RETCOM insert. The SMDR import
--    (1b.13) still carries historical RETCOM rows: dcs.import_mode = 'on'
--    lifts the refusal, exactly as it lifts the manual-number refusal. It has
--    to bring a code that UNIQUE (document_id, scl_revision) accepts, which is
--    not the number of the IFR row it returns — the convention for that is
--    1b.13's to choose (docs/deferred-tasks.md yy).
--
-- 2. dcs.next_revision_code is SECURITY INVOKER, with EXECUTE granted to
--    `authenticated` — unlike dcs.next_doc_number, which is a definer with no
--    grant (see that migration's decision 1, whose comment anticipated this
--    choice and its cost). RLS on dcs.revisions shows a signed-in caller every
--    revision of a document they are a member of, which is the whole set that
--    matters, and a non-member sees none and gets an error about the document
--    rather than a number. It is therefore not a SECURITY DEFINER function
--    that authenticated can execute, so advisor lint 0029 does not move from
--    its baseline of 12. An invoker function does NOT inherit the definer
--    hardening: search_path is set explicitly and every name is
--    schema-qualified.
--
--    The trigger is the other half: public.assign_scl_revision() is SECURITY
--    DEFINER and calls this function in its own context, so the number that is
--    stored is computed over every row whoever the caller is. The number is the
--    revision's identity and may not depend on who asked. A caller-side
--    proposal (the dialog) and the stored number can therefore differ only by
--    a race — and the trigger's answer is the one that counts.
--
-- 3. WHO MAY SUPPLY A CODE ON INSERT. The task's rule, in the order the trigger
--    checks it: NULL -> generated for anyone. A value supplied is accepted from
--    (a) the project's Document Controller in an aal2 session — and then it is
--    checked against the series of the step (decision 6) — (b) a session with
--    dcs.import_mode = 'on' (SMDR import, stored verbatim), and (c) a session
--    with no user at all (below). Anyone else, an ORIG included, gets 42501
--    insufficient_privilege, in the two wordings public.enforce_dc_only_numbering
--    uses (not the DC / no verified second factor), so the app can tell them
--    apart the way it already does for the CPY number.
--
--    (c) is the auth.uid() IS NULL BYPASS, carried over from
--    public.enforce_dc_only_numbering() (1b.01/1b.03) on purpose. It is an
--    authorization rule about which SIGNED-IN user may override the number; a
--    session-less caller (a migration, supabase/seed.sql, psql, service_role)
--    has no dcs.project_roles row to check, already bypasses RLS on this table,
--    and is the only caller that can repair a row. NAMED, because it is easy to
--    miss: service_role falls into this bypass too, so any server-side API
--    route that writes dcs.revisions with the service key can set
--    scl_revision freely. Checked when this was written: no such route exists
--    (the only service-key modules are the Timesheet admin client and the DCS
--    MDR export, neither of which writes dcs.revisions). If one is ever added,
--    that is a decision to make on purpose, not a default. This is a DIFFERENT
--    choice from public.assign_scl_doc_number, which has no such bypass — see
--    docs/adr/0015-numeracja-rewizji-serie-retcom-bypass.md for why the two
--    generators are allowed to differ.
--
-- 4. Ceilings chosen here rather than asked about, both raised instead of
--    widened (the same choice 1b.02 made for SEQ > 9999): an IDC series past
--    Z, and an IFR series past 99. A code that does not fit its format is worse
--    than a refused insert. Widening either is a format change, not something
--    this function may decide.
--
-- 5. import_mode also lifts revisions_refuse_void_document. A historical
--    Void document normally has the revisions it had before it was voided, and
--    the import should not have to order its writes around this trigger. In an
--    ordinary session a Void document takes no new revision, and there is no
--    session-less bypass for that: unlike who may hand-enter a number, it is a
--    fact about the document.
--
-- 6. A DC-SUPPLIED CODE IS VALIDATED against the shape of its step's series
--    (one capital letter for IDC, two digits for IFR, a plain number for the
--    finals): the task's goal says validation covers the SCL track, and
--    docs/deferred-tasks.md (pp) was open precisely because nothing checked
--    the format. A DC may choose ANY code of the right shape — out of
--    sequence, skipping one, re-using a number that is free — because the
--    override exists for the cases the generator cannot know; UNIQUE (document_id,
--    scl_revision) still refuses a clash (23505). The shapes live in ONE place,
--    dcs.revision_series_pattern(), which both this validation and
--    next_revision_code read, so they cannot drift apart. The import and the
--    session-less caller are NOT validated: the import owns the format of what
--    it carries, and a caller that can already write the table directly is not
--    made safer by a check it can also bypass.
--
--    THE CHECK APPLIES AT INSERT ONLY. UNIQUE (document_id, scl_revision) would
--    not catch 'A1' or '0', which is why the shape is checked at all — but after
--    the row exists, revisions_numbering_dc_only (1b.01, deliberately untouched
--    here) lets the project's DC at aal2 UPDATE scl_revision, and it checks WHO
--    changes the column, not WHAT it is changed to. A DC can therefore move a
--    code past this validation with an UPDATE. That is a known, logged gap
--    (docs/deferred-tasks.md yy), not something this migration closes.

-- ==================================================================
-- 0. dcs.revision_series_pattern: the shape of a code, per step
-- ==================================================================
--
-- The single definition of "what a valid code looks like" for a step, read by
-- both dcs.next_revision_code (to know which stored values count) and
-- public.assign_scl_revision (to validate a code a DC supplies). NULL for a
-- step with no series — RETCOM, or a step a DC added to the dictionary.
--
-- IMMUTABLE and SECURITY INVOKER: it reads nothing, so it has no view of the
-- caller to get wrong and is not a SECURITY DEFINER function authenticated can
-- execute (lint 0029 does not move). EXECUTE is granted to authenticated
-- because next_revision_code, an invoker, calls it with the caller's rights.
create function dcs.revision_series_pattern(p_step_code text) returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select case p_step_code
    when 'IDC' then '^[A-Z]$'
    when 'IFR' then '^[0-9]{2}$'
    when 'IFC' then '^[1-9][0-9]{0,5}$'
    when 'IFI' then '^[1-9][0-9]{0,5}$'
    when 'IFB' then '^[1-9][0-9]{0,5}$'
  end;
$$;

comment on function dcs.revision_series_pattern(text) is
  'The regular expression a valid SCL revision code must match for a workflow '
  'step: ^[A-Z]$ for IDC, ^[0-9]{2}$ for IFR, ^[1-9][0-9]{0,5}$ for IFC/IFI/IFB, '
  'NULL for a step with no series. Read by dcs.next_revision_code and by '
  'public.assign_scl_revision so the counting and the validation cannot drift '
  '(DCS 1b.08).';

revoke execute on function dcs.revision_series_pattern(text) from public, anon;
grant execute on function dcs.revision_series_pattern(text) to authenticated, service_role;

-- ==================================================================
-- 1. dcs.next_revision_code
-- ==================================================================
create function dcs.next_revision_code(
  p_document_id uuid,
  p_step_id     uuid
) returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_step_code text;
  v_series    text;
  v_steps     text[];
  v_pattern   text;
  v_max       integer;
begin
  select d.code into v_step_code
    from dcs.dictionaries d
   where d.id = p_step_id
     and d.dict_type = 'workflow_step';
  if v_step_code is null then
    raise exception
      'dcs.next_revision_code: % is not a dcs.dictionaries row of dict_type ''workflow_step'' — the series of the revision cannot be resolved.',
      p_step_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- RETCOM first, and named: it is a real workflow step that deliberately has
  -- no series (decision 1), and the caller deserves the reason, not "unknown
  -- step".
  if v_step_code = 'RETCOM' then
    raise exception
      'dcs.next_revision_code: step RETCOM has no SCL revision series. RETCOM is the client returning a document, not SCL issuing a revision — in the register it carries the number of the IFR revision it returns, which UNIQUE (document_id, scl_revision) cannot hold. This is deliberate, not an oversight. Historical RETCOM rows are carried by the SMDR import (dcs.import_mode).'
      using errcode = 'invalid_parameter_value';
  end if;

  case v_step_code
    when 'IDC' then
      v_series := 'idc';   v_steps := array['IDC'];
    when 'IFR' then
      v_series := 'ifr';   v_steps := array['IFR'];
    when 'IFC', 'IFI', 'IFB' then
      v_series := 'final'; v_steps := array['IFC', 'IFI', 'IFB'];
    else
      -- A code a DC added to the workflow_step dictionary after 1a.18. It has
      -- no series until someone defines one, and inventing one here would be
      -- the state machine's decision, not this function's.
      raise exception
        'dcs.next_revision_code: step % has no SCL revision series (IDC, IFR and IFC/IFI/IFB have one).',
        v_step_code
        using errcode = 'invalid_parameter_value';
  end case;

  v_pattern := dcs.revision_series_pattern(v_step_code);

  -- An invoker's view: a document the caller cannot see is reported as not
  -- found, which is also what a document that does not exist looks like.
  if not exists (select 1 from dcs.documents d where d.id = p_document_id) then
    raise exception
      'dcs.next_revision_code: no dcs.documents row with id % is visible to the caller.',
      p_document_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- THE line that makes this atomic. A transaction-scoped advisory lock keyed
  -- on DOCUMENT + SERIES — the exact scope the counter counts in — taken
  -- BEFORE the read and held until commit, so no second transaction inserting
  -- the same series on the same document can read the same maximum. Without
  -- it, two originators pressing Create at once both read "A" and both try to
  -- write "B". The prefix keeps the key out of the space dcs.next_doc_number
  -- uses; a hashtext collision between two unrelated keys is harmless (they
  -- merely take turns).
  --
  -- Deliberately not a sequence object, for the reason 1b.02 gives: the table
  -- is the record of what has been issued, including what the import carried.
  perform pg_advisory_xact_lock(
    hashtext('dcs.revisions:' || p_document_id::text || ':' || v_series)::bigint);

  -- Highest code already used in this series on this document. The pattern is
  -- the series' shape, so a value in another format contributes nothing (see
  -- the header); it also guarantees the integer cast below never sees text.
  select max(
           case v_series
             when 'idc' then ascii(r.scl_revision) - 64   -- A = 1 … Z = 26
             else r.scl_revision::integer
           end)
    into v_max
    from dcs.revisions r
    join dcs.dictionaries s on s.id = r.step_id
   where r.document_id = p_document_id
     and s.code = any (v_steps)
     and r.scl_revision ~ v_pattern;

  if v_series = 'idc' then
    if coalesce(v_max, 0) >= 26 then
      raise exception
        'dcs.next_revision_code: the IDC series on document % has reached Z. Extending it (AA, AB …) is a format change, not something this function may decide.',
        p_document_id
        using errcode = 'numeric_value_out_of_range';
    end if;
    return chr(65 + coalesce(v_max, 0));            -- none yet -> A
  elsif v_series = 'ifr' then
    if v_max >= 99 then
      raise exception
        'dcs.next_revision_code: the IFR series on document % has reached 99, which is the last two-digit code. Widening it is a format change, not something this function may decide.',
        p_document_id
        using errcode = 'numeric_value_out_of_range';
    end if;
    return lpad((coalesce(v_max, -1) + 1)::text, 2, '0');   -- none yet -> 00
  else
    return (coalesce(v_max, 0) + 1)::text;                  -- none yet -> 1
  end if;
end;
$$;

comment on function dcs.next_revision_code(uuid, uuid) is
  'The next SCL revision code for a document + workflow step: A, B … for IDC, '
  '00, 01 … for IFR, 1, 2 … for IFC/IFI/IFB (one shared counter). The '
  'counter is the highest code already used by that series'' steps on the '
  'document plus one; a stored value that does not fit the series'' shape '
  'contributes nothing. RETCOM has no series and raises, by design. Atomic '
  'through pg_advisory_xact_lock over DOCUMENT + SERIES, taken before the '
  'read. SECURITY INVOKER: RLS scopes what the caller sees, and EXECUTE is '
  'granted to authenticated so the New Revision dialog can propose a code. '
  'The stored number is computed by public.assign_scl_revision(), a definer '
  'that calls this in its own context, so it is over every row whoever '
  'inserts (DCS 1b.08).';

-- An explicit grant list, not a default: dcs default privileges would hand
-- EXECUTE to whoever they name, and anon must never be able to call this.
revoke execute on function dcs.next_revision_code(uuid, uuid)
  from public, anon;
grant execute on function dcs.next_revision_code(uuid, uuid)
  to authenticated, service_role;

-- ==================================================================
-- 2. The BEFORE INSERT trigger: fill it, or refuse it.
-- ==================================================================
--
-- SECURITY DEFINER for the reason public.assign_scl_doc_number is: the number
-- must be computed over every revision of the document, not over what the
-- inserting caller's policies show. Its search_path is pinned, and it reads
-- only dcs.dictionaries directly — the counting is next_revision_code's.
create function public.assign_scl_revision() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_step_code text;
  v_pattern   text;
  v_import    boolean := coalesce(current_setting('dcs.import_mode', true), '') = 'on';
begin
  select d.code into v_step_code
    from dcs.dictionaries d
   where d.id = new.step_id
     and d.dict_type = 'workflow_step';

  -- RETCOM has no series (decision 1). Refused whatever else is supplied, and
  -- before the session-less bypass below: this is a fact about the workflow,
  -- not an authorization rule about who may override a number. Only the import
  -- carries historical RETCOM rows.
  if v_step_code = 'RETCOM' and not v_import then
    raise exception
      'dcs.revisions: a revision on step RETCOM cannot be created. RETCOM has no SCL revision series — it is the client returning a document, not SCL issuing a revision, and in the register it carries the number of the IFR revision it returns, which UNIQUE (document_id, scl_revision) cannot hold. This is deliberate, not an oversight. Only the SMDR import may carry historical RETCOM rows, in a session that has set dcs.import_mode = ''on''.'
      using errcode = 'check_violation';
  end if;

  -- The normal path: no code supplied, the system assigns one. NOT NULL on the
  -- column is satisfied because it is checked after BEFORE triggers.
  if new.scl_revision is null then
    new.scl_revision := dcs.next_revision_code(new.document_id, new.step_id);
    return new;
  end if;

  -- The SMDR import carries the codes historical revisions have always had.
  if v_import then
    return new;
  end if;

  -- No session: a migration, supabase/seed.sql, psql or a service_role call.
  -- Carried over from public.enforce_dc_only_numbering(), reasoning included:
  -- this is an AUTHORIZATION rule — it decides which of several signed-in
  -- users may override the number — and a session-less caller has no
  -- dcs.project_roles row to check and already bypasses RLS on this table, so
  -- refusing here would only make this column the one thing postgres cannot
  -- repair. NAMED: service_role falls into this branch too, so a server-side
  -- route that inserts revisions with the service key can set scl_revision
  -- freely (decision 3).
  if auth.uid() is null then
    return new;
  end if;

  -- A signed-in user supplied a code. Only the project's Document Controller
  -- in an aal2 session may. The two refusals are 42501 insufficient_privilege
  -- and worded as enforce_dc_only_numbering words them, because the fix differs
  -- (someone else's job / a second-factor challenge) and the app tells them apart
  -- by message, as it does for the CPY number.
  if not public.is_doc_controller(new.project_id) then
    raise exception
      'dcs.revisions.scl_revision is assigned by the system; a value may be supplied on INSERT only by the Document Controller of this project (dcs.project_roles role ''dc''). Leave it NULL and the code is generated from the step (got %). Caller: %.',
      quote_literal(new.scl_revision), coalesce(auth.uid()::text, '<no session>')
      using errcode = 'insufficient_privilege';
  end if;
  if ((select auth.jwt()) ->> 'aal') is distinct from 'aal2' then
    raise exception
      'dcs.revisions.scl_revision may be supplied on INSERT only in a session with a verified second factor (aal2). Current assurance level: %.',
      coalesce(((select auth.jwt()) ->> 'aal'), '<no session>')
      using errcode = 'insufficient_privilege';
  end if;

  -- The DC's code has to be a code of the step's series (decision 6). Which
  -- code within the series is theirs to choose. INSERT only: the UPDATE path
  -- (revisions_numbering_dc_only, 1b.01) does not run this check.
  v_pattern := dcs.revision_series_pattern(v_step_code);
  if v_pattern is null or new.scl_revision !~ v_pattern then
    raise exception
      'dcs.revisions.scl_revision % is not a valid code for step %. IDC codes are one capital letter (A, B …), IFR codes are two digits (00, 01 …) and IFC / IFI / IFB codes are a plain number (1, 2 …).',
      quote_literal(new.scl_revision), coalesce(v_step_code, '<unknown step>')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.assign_scl_revision() is
  'BEFORE INSERT row trigger for dcs.revisions. NULL scl_revision -> filled '
  'from dcs.next_revision_code(). A supplied one -> accepted from the '
  'project''s Document Controller in an aal2 session (and then checked '
  'against the step''s series, 23514 if it does not fit), 42501 for any other '
  'signed-in user; passed as it is for a session-less caller (migration, '
  'seed, psql, service_role) and under dcs.import_mode = ''on'' (SMDR '
  'import). A RETCOM step is refused (23514) unless dcs.import_mode = ''on'': '
  'RETCOM has no SCL series, by design. The INSERT-side half of "a number '
  'may not be entered by hand"; the UPDATE side is '
  'revisions_numbering_dc_only (1b.01) and is not touched. SECURITY DEFINER '
  'so the code is computed over every revision of the document, not the '
  'rows the inserting caller can see (DCS 1b.08).';

revoke execute on function public.assign_scl_revision()
  from public, anon, authenticated, service_role;

-- Named to sort first among the BEFORE triggers of dcs.revisions (they fire in
-- name order): revisions_assign_scl_revision < revisions_cpy_numbering <
-- revisions_numbering_dc_only_insert < revisions_refuse_void_document. The code
-- exists before any other guard reports on the row, and a refused insert
-- reaches no AFTER trigger, so it leaves no audit_log entry.
create trigger revisions_assign_scl_revision
  before insert on dcs.revisions
  for each row execute function public.assign_scl_revision();

-- ==================================================================
-- 3. No revisions on a Void document.
-- ==================================================================
--
-- A Void document is a dead one: its number never returns to the pool and
-- nothing further is issued on it (docs/00-glossary.md). SECURITY DEFINER
-- because the failure direction matters: as an invoker a document the caller's
-- policies hide would read as "not Void" and the insert would pass. Here it
-- reads the real status.
create function public.refuse_revision_on_void_document() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status_code text;
begin
  -- Historical Void documents arrive with their revisions (decision 5).
  if coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  select s.code into v_status_code
    from dcs.documents d
    join dcs.dictionaries s on s.id = d.workflow_status_id
   where d.id = new.document_id;

  if v_status_code = 'VOID' then
    raise exception
      'dcs.revisions: document % is Void and takes no new revisions. A Void document keeps its number and its history; to continue the work, create a new document.',
      new.document_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.refuse_revision_on_void_document() is
  'BEFORE INSERT row trigger for dcs.revisions: raises 23514 when the '
  'document''s workflow status is VOID, unless the session set '
  'dcs.import_mode = ''on'' (SMDR import). No session-less bypass — a Void '
  'document is a fact about the document, not an authorization question. '
  'SECURITY DEFINER so a document the caller cannot see is not mistaken for '
  'one that is not Void (DCS 1b.08).';

revoke execute on function public.refuse_revision_on_void_document()
  from public, anon, authenticated, service_role;

create trigger revisions_refuse_void_document
  before insert on dcs.revisions
  for each row execute function public.refuse_revision_on_void_document();

-- ==================================================================
-- 4. The column comment 1b.03 wrote while waiting for this migration.
-- ==================================================================
comment on column dcs.revisions.scl_revision is
  'The revision code of the SCL track: A, B … for IDC; 00, 01 … for IFR; 1, 2 '
  '… for IFC/IFI/IFB (one shared counter). Assigned by the database on INSERT '
  '(trigger revisions_assign_scl_revision -> dcs.next_revision_code), never by '
  'the caller — except the project''s DC at aal2, who may supply a code of '
  'the step''s series; any other signed-in user gets 42501. Passed for a '
  'session-less caller (migration, seed, psql, service_role) and under '
  'dcs.import_mode = ''on'' (SMDR import). RETCOM has no series and cannot be '
  'created outside the import. Unique within the document. Changing it after '
  'the fact needs the project''s DC at aal2 (trigger '
  'revisions_numbering_dc_only, 1b.01).';
