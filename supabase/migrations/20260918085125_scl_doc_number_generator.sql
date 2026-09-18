-- DCS 1b.02: the SCL document-number generator.
--
-- The SCL number is the document's identity (brief §6.1–6.2): never duplicated,
-- never changed, never re-issued. 1b.01 created dcs.documents with
-- scl_doc_number NOT NULL UNIQUE and an UPDATE-side immutability trigger, and
-- left the number to be supplied by a caller that did not exist yet. This
-- migration removes the caller's say in it:
--
--   * dcs.next_doc_number() builds the number PROJECT-ORIG-TYPE-SEQ-LANG,
--   * a BEFORE INSERT trigger fills scl_doc_number when it is NULL,
--   * the same trigger REFUSES an insert that supplies one, unless the session
--     opened the import escape hatch (GUC dcs.import_mode = 'on').
--
-- The UPDATE side is untouched: documents_scl_number_immutable /
-- forbid_scl_doc_number_change() (1b.01) still owns it, unconditionally. This
-- migration changes the body of no existing function.
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (all confirmed before it was written)
-- ------------------------------------------------------------------
-- 1. SECURITY DEFINER, EXECUTE revoked from every API role. The 1b.01 trigger
--    functions are SECURITY INVOKER because the tables they read
--    (dcs.mdr_settings, public.sub_projects) are readable by every
--    authenticated user anyway. This one reads dcs.documents, which is
--    RLS-filtered — a policy that hid a row would make the generator compute
--    the maximum from a partial view. The number is the document's identity,
--    so it may not depend on who is asking. Advisor lint 0029 counts
--    SECURITY DEFINER functions the `authenticated` role can EXECUTE; both
--    functions here revoke it, so the baseline of 12 does not move. Cost, on
--    the record: dcs.next_doc_number is NOT callable as a PostgREST RPC. If
--    1b.04 wants to show the next number before the document is saved it must
--    grant EXECUTE then and accept 0029 going to 13.
--
-- 2. The maximum is taken over rows matching project_id AND doc_type_id (the
--    columns), and SEQ is parsed out of the stored number leniently — the last
--    run of 1..6 digits before the final segment. The lenient form is for the
--    Excel migration (1b.12–1b.15): a historical SC2601-SCL-RA-12-EN counts
--    toward the maximum instead of being invisible to it, which would restart
--    the register at 0001. A number that matches nothing contributes nothing;
--    the global UNIQUE on scl_doc_number is the backstop, so the failure mode
--    is a loud 23505, never a silent duplicate.
--
-- 3. The import escape hatch is the GUC alone, as the task specified. A REST
--    client cannot issue SET, so the only callers who can open it (postgres,
--    service_role, psql) are the ones that could write the table directly
--    anyway. NOT added: a second `auth.uid() is null` test — that would decide
--    now that the import may never run from a signed-in DC session, which is
--    1b.12–1b.15's call to make, not this task's.
--
-- 4. NOT done here, although 1b.01 pointed at this task for it: refusing to
--    create a document at all on a project with no dcs.mdr_settings row. It is
--    a bigger rule than numbering — it decides what "DCS runs this project"
--    means for every future table — and it stays open in
--    docs/deferred-tasks.md (oo). SCMS-IT on scl-dev is in exactly that state
--    and its documents keep being creatable.
--
-- Two limits chosen here rather than asked about, both named in
-- docs/02-data-model.md: SEQ > 9999 raises instead of widening the field to
-- five digits (a number that does not fit the format is worse than a refused
-- insert), and p_orig is checked against ^[A-Z0-9]{1,10}$ — a hyphen in ORIG
-- would put a sixth field in the number and break the parser below.

-- ==================================================================
-- 1. dcs.next_doc_number
-- ==================================================================
create function dcs.next_doc_number(
  p_project_id  uuid,
  p_doc_type_id uuid,
  p_language_id uuid,
  p_orig        text default 'SCL'
) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_project_code  text;
  v_doc_type_code text;
  v_language_code text;
  v_orig          text := upper(btrim(coalesce(p_orig, '')));
  v_seq           integer;
begin
  -- Resolve the three code segments. Each is checked separately so the message
  -- names which one is wrong: the generator is called from a BEFORE INSERT
  -- trigger, i.e. BEFORE the composite dictionary foreign keys of 1b.01 have
  -- run, so a caller passing a language id as the doc type reaches here first
  -- and deserves better than a 23503 about a generated discriminator column.
  select p.project_code into v_project_code
    from public.projects p
   where p.id = p_project_id;
  if v_project_code is null then
    raise exception
      'dcs.next_doc_number: no public.projects row with id % — the PROJECT segment of the number cannot be resolved.',
      p_project_id
      using errcode = 'invalid_parameter_value';
  end if;

  select d.code into v_doc_type_code
    from dcs.dictionaries d
   where d.id = p_doc_type_id
     and d.dict_type = 'doc_type';
  if v_doc_type_code is null then
    raise exception
      'dcs.next_doc_number: % is not a dcs.dictionaries row of dict_type ''doc_type'' — the TYPE segment of the number cannot be resolved.',
      p_doc_type_id
      using errcode = 'invalid_parameter_value';
  end if;

  select d.code into v_language_code
    from dcs.dictionaries d
   where d.id = p_language_id
     and d.dict_type = 'language';
  if v_language_code is null then
    raise exception
      'dcs.next_doc_number: % is not a dcs.dictionaries row of dict_type ''language'' — the LANG segment of the number cannot be resolved.',
      p_language_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- ORIG has no dictionary (docs/00-glossary.md: SCL is the originator code of
  -- Sea Clouds itself). Only its shape is guarded, and only for the one reason
  -- that matters: a hyphen would add a field to the number and break the SEQ
  -- parser below, which reads from the right.
  if v_orig !~ '^[A-Z0-9]{1,10}$' then
    raise exception
      'dcs.next_doc_number: ORIG must be 1..10 upper-case letters or digits, got %. A separator in ORIG would add a field to the number.',
      coalesce(quote_literal(p_orig), 'NULL')
      using errcode = 'invalid_parameter_value';
  end if;

  -- THE line that makes this atomic. A transaction-scoped advisory lock keyed
  -- on PROJECT+TYPE — the exact scope SEQ counts in — taken BEFORE the read and
  -- held until commit, so no second transaction can read the same maximum. A
  -- plain `select max` without it is a classic read-then-write race: twenty
  -- concurrent inserts read the same maximum and twenty produce the same
  -- number. hashtext collisions between different PROJECT+TYPE pairs are
  -- harmless — two unrelated pairs would merely take turns.
  --
  -- Deliberately NOT a Postgres sequence object: documents are migrated from
  -- Excel carrying their historical numbers (brief §13.2), and a sequence knows
  -- nothing about numbers that were never drawn from it. The table is the
  -- record of what has been issued.
  perform pg_advisory_xact_lock(hashtext(v_project_code || v_doc_type_code)::bigint);

  -- Highest SEQ already used in this PROJECT + TYPE, plus one.
  --
  -- No filter on workflow_status: a Void document keeps its row and its number,
  -- and counting it is the whole point — docs/00-glossary.md, "Numer Void nigdy
  -- nie wraca do puli". Gaps are likewise never filled: this is max + 1, not
  -- the first free slot.
  --
  -- The regex reads from the RIGHT, not by field index, because project_code
  -- may itself contain a hyphen: SCMS-IT is a live project code on scl-dev and
  -- SCMS-IT-SCL-RA-0001-EN has six fields, not five.
  select coalesce(max(substring(d.scl_doc_number from '-([0-9]{1,6})-[^-]*$')::integer), 0) + 1
    into v_seq
    from dcs.documents d
   where d.project_id = p_project_id
     and d.doc_type_id = p_doc_type_id;

  if v_seq > 9999 then
    raise exception
      'dcs.next_doc_number: SEQ would be % for % / %, which does not fit the four-digit field. Widening it is a format change, not something this function may decide.',
      v_seq, v_project_code, v_doc_type_code
      using errcode = 'numeric_value_out_of_range';
  end if;

  return v_project_code || '-' || v_orig || '-' || v_doc_type_code || '-'
      || lpad(v_seq::text, 4, '0') || '-' || v_language_code;
end;
$$;

comment on function dcs.next_doc_number(uuid, uuid, uuid, text) is
  'The next SCL document number for a project + document type, as the ready '
  'string PROJECT-ORIG-TYPE-SEQ-LANG (e.g. SC2601-SCL-RA-0012-EN). SEQ is the '
  'highest sequence already present in dcs.documents for that PROJECT + TYPE '
  'plus one, Void documents included, zero-padded to four digits — gaps are '
  'never filled and a Void number never returns. Atomic through '
  'pg_advisory_xact_lock over PROJECT+TYPE, taken before the read and held to '
  'commit. SECURITY DEFINER so the maximum is taken over every row, not only '
  'the rows the caller''s RLS policies let them see; EXECUTE is revoked from '
  'every API role, so it is not reachable as an RPC — it is called by '
  'public.assign_scl_doc_number() alone (DCS 1b.02).';

revoke execute on function dcs.next_doc_number(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- ==================================================================
-- 2. The BEFORE INSERT trigger: fill it, or refuse it.
-- ==================================================================
--
-- In public next to the four 1b.01 trigger functions, is_admin() and
-- audit_trigger() — the established home for cross-schema helpers.
--
-- SECURITY DEFINER for one concrete reason on top of the RLS argument above:
-- dcs.next_doc_number has no EXECUTE for any API role, and EXECUTE on a
-- function called from inside a PL/pgSQL body IS checked at run time (unlike a
-- trigger function, which is checked at CREATE TRIGGER). A SECURITY INVOKER
-- trigger here would fail with 42501 for every signed-in caller.
create function public.assign_scl_doc_number() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- The normal path: no number supplied, the system assigns one. NOT NULL on
  -- the column is satisfied because it is checked after BEFORE triggers.
  if new.scl_doc_number is null then
    new.scl_doc_number := dcs.next_doc_number(
      new.project_id, new.doc_type_id, new.language_id);
    return new;
  end if;

  -- The escape hatch, for the SMDR import alone (brief §13.2): historical
  -- documents arrive with the numbers they have always had, and re-numbering
  -- them would break every paper trail that refers to them. Stored verbatim —
  -- the import owns the format of what it carries.
  if coalesce(current_setting('dcs.import_mode', true), '') = 'on' then
    return new;
  end if;

  raise exception
    'dcs.documents.scl_doc_number is assigned by the system and may not be supplied on INSERT (got %). Leave it NULL and the number is generated. Only the SMDR import may carry historical numbers, in a session that has set dcs.import_mode = ''on''.',
    quote_literal(new.scl_doc_number)
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.assign_scl_doc_number() is
  'BEFORE INSERT row trigger for dcs.documents. NULL scl_doc_number -> filled '
  'from dcs.next_doc_number(); non-NULL -> 23001, unless the session set the '
  'GUC dcs.import_mode = ''on'', in which case the supplied number is stored '
  'verbatim (SMDR import, brief §13.2). This is the INSERT-side half of "a '
  'number may not be entered by hand"; the UPDATE side is '
  'forbid_scl_doc_number_change() from 1b.01 and is not touched. SECURITY '
  'DEFINER because dcs.next_doc_number has no EXECUTE for any API role and '
  'that grant IS checked at run time for a call inside a function body (DCS '
  '1b.02).';

revoke execute on function public.assign_scl_doc_number()
  from public, anon, authenticated, service_role;

-- Named to sort first among the BEFORE triggers of dcs.documents (they fire in
-- name order): documents_assign_scl_number < documents_cpy_numbering <
-- documents_ctr_code_project < set_updated_at. The number exists before any
-- other guard reports on the row, and a refused insert still reaches no AFTER
-- trigger, so it leaves no audit_log entry.
create trigger documents_assign_scl_number
  before insert on dcs.documents
  for each row execute function public.assign_scl_doc_number();

-- ==================================================================
-- 3. The column comment 1b.01 wrote while waiting for this migration.
-- ==================================================================
comment on column dcs.documents.scl_doc_number is
  'PROJECT-ORIG-TYPE-SEQ-LANG (e.g. SC2601-SCL-RA-0012-EN). Assigned by the '
  'database on INSERT (trigger documents_assign_scl_number -> '
  'dcs.next_doc_number), never by the caller: supplying one raises 23001 '
  'unless the session set dcs.import_mode = ''on'' for the SMDR import. '
  'Immutable after insert, for every role including admin and postgres '
  '(trigger documents_scl_number_immutable): a wrong document is Voided and '
  'replaced, its number never returns to the pool.';
