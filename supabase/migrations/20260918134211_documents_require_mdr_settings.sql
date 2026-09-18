-- DCS 1b.04: no documents on a project DCS does not run.
--
-- A missing dcs.mdr_settings row means "DCS does not run this project"
-- (1a.05, and the table comment says so). 1b.01 named this rule and pointed at
-- 1b.02; 1b.02 declined it in writing ("a bigger rule than numbering — it
-- decides what 'DCS runs this project' means for every future table") and left
-- it in docs/deferred-tasks.md (oo), naming 1b.04 or a task of its own as the
-- place it belongs. This is 1b.04, and this migration closes it.
--
-- The frontend half — the project selector refusing to submit, with a message
-- telling the user the DC must configure the project's MDR first — is in
-- apps/dcs/lib/documents.ts. It duplicates this rule for the sake of a decent
-- message; it does not replace it (CLAUDE.md).
--
-- ------------------------------------------------------------------
-- Decisions taken for this migration (all confirmed before it was written)
-- ------------------------------------------------------------------
-- 1. NO bypass of any kind — not the `auth.uid() is null` escape that
--    enforce_dc_only_numbering() carries, and not the dcs.import_mode GUC that
--    1b.02 built. Confirmed explicitly. The reasoning is the one 1b.01 used to
--    separate its two kinds of rule: enforce_dc_only_numbering is an
--    AUTHORIZATION rule (which of several signed-in users may act) and so has
--    a sessionless bypass, while this is a FACT about the project's
--    configuration and has no reading under which the answer depends on who is
--    asking. postgres, the seed, psql and service_role are refused too.
--
--    The cost is real and belongs on the record rather than in a surprise:
--    the SMDR import (1b.12-1b.15) CANNOT load a project's historical register
--    before that project has an mdr_settings row. It must create the MDR
--    configuration first. Nothing warns it today — dcs.documents is empty on
--    scl-dev, so there is no data to discover this against — which is exactly
--    why it is written here. If that ordering turns out to be impossible for
--    the import, the fix is a new migration adding the import_mode branch, not
--    an edit to this one.
--
-- 2. BEFORE INSERT only, NOT `before insert or update`. dcs.mdr_settings is
--    admin-writable ("Admins manage mdr settings", 1a.05) and its only
--    ON DELETE CASCADE comes from public.projects — which would take the
--    documents with it. So a project CAN be left with documents and no
--    mdr_settings row, by an admin deleting the settings row alone. Guarding
--    UPDATE as well would make every one of those documents permanently
--    uneditable, including the Void that is the brief's answer to a document
--    that should not exist. A rule that traps data is worse than the gap it
--    closes. "Creating" is what the task asked to block, and creating is what
--    this blocks.
--
-- 3. SQLSTATE 23514 (check_violation), matching enforce_cpy_numbering_enabled()
--    — its sibling guard, which answers the same question about the same
--    missing row one layer earlier. Two guards sharing a SQLSTATE is only safe
--    because they are told apart by message, and the tests assert the message,
--    not just the code.
--
-- 4. Trigger NAME chosen for firing order, which is name order among BEFORE
--    triggers. `documents_mdr_required` sorts:
--      documents_assign_scl_number < documents_cpy_numbering
--        < documents_ctr_code_project < documents_mdr_required
--        < documents_numbering_dc_only
--    Deliberately AFTER documents_cpy_numbering: an insert that carries a CPY
--    number on a project with no mdr_settings row must keep getting the CPY
--    guard's answer, which is the more specific one and which existing tests
--    (rls_document_register.test.sql, dc_only_numbering_on_insert.test.sql)
--    already assert. Sorting before it would have silently changed the message
--    those two files read.
--
--    Sorting AFTER documents_assign_scl_number is harmless: dcs.next_doc_number
--    takes an advisory lock and reads, it writes nothing, so a number computed
--    for an insert this trigger then refuses costs one lock in a transaction
--    that is about to abort. Nothing is consumed — the table is the record of
--    what was issued (1b.02), not a sequence.
--
-- 5. SECURITY INVOKER, EXECUTE revoked from every API role — the same pair of
--    choices, for the same reason, as enforce_cpy_numbering_enabled(): the only
--    table it reads is dcs.mdr_settings, which every authenticated user may
--    already read ("Authenticated users can read mdr settings", 1a.05), so
--    SECURITY DEFINER would buy nothing and would move advisor lint 0029 off
--    its baseline of 12 (docs/03-conventions.md).

create function public.enforce_document_needs_mdr() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if exists (
    select 1 from dcs.mdr_settings m
     where m.project_id = new.project_id
  ) then
    return new;
  end if;

  raise exception
    'dcs.documents cannot be created on project %: it has no dcs.mdr_settings row, which means DCS does not run this project. Its Document Controller must configure the project MDR first.',
    new.project_id
    using errcode = 'check_violation';
end;
$$;

comment on function public.enforce_document_needs_mdr() is
  'BEFORE INSERT row trigger for dcs.documents: refuses a document on a '
  'project with no dcs.mdr_settings row, because a missing row means "DCS does '
  'not run this project" (1a.05). Raises 23514, like its sibling '
  'enforce_cpy_numbering_enabled() — told apart by message, not SQLSTATE. No '
  'bypass at all: not the auth.uid() escape enforce_dc_only_numbering() has, '
  'not the dcs.import_mode GUC of 1b.02. This is a fact about the project, not '
  'a question of who is asking, so postgres and service_role are refused too — '
  'which means the SMDR import must create the MDR before the register. INSERT '
  'only: guarding UPDATE would make documents uneditable, Void included, on a '
  'project whose settings row an admin later deleted (DCS 1b.04).';

revoke execute on function public.enforce_document_needs_mdr()
  from public, anon, authenticated, service_role;

create trigger documents_mdr_required
  before insert on dcs.documents
  for each row execute function public.enforce_document_needs_mdr();
