-- DCS 1a.15b: make dcs.dictionaries.code immutable in the database.
--
-- Until now `code` was protected only by the application: the type
-- UpdateDictionaryEntryInput (apps/dcs/lib/dictionaries-admin.ts) carries no
-- `code` field and parseUpdateDictionaryEntryInput drops one present in a raw
-- payload. Neither survives a call that does not go through that module: the
-- 1a.09b/1a.11 policies "Doc controllers update dictionaries" and the admin
-- "Admins manage dictionaries" grant UPDATE without looking at which columns
-- changed (read from scl-dev 2026-09-11: no column list, no WHERE on code), so
-- a DC with an aal2 session could PATCH /rest/v1/dictionaries?id=eq.… with
-- {"code":"…"} today and succeed.
--
-- From 1b.02 `code` is a segment of the SCL document number
-- (SC2601-SCL-RA-0012-EN: RA = doc_type code, EN = language code,
-- docs/00-glossary.md), and documents keep pointing at the dictionary row by
-- id — so a later code change would retroactively re-read every historical
-- number. The rule "deactivate, never rewrite" (is_active = false; 1a.07)
-- needs the database to enforce the second half of it.
--
-- Unconditional on purpose: no role branch, no admin bypass, no
-- session_replication_role escape. The UI must never enforce a rule the
-- database does not, and there is no reading of "code is part of the document
-- number" under which an admin may change it. A correction to a wrong code is
-- a new row plus is_active = false on the old one; a genuine renaming of the
-- concept is `label`, which stays editable.
--
-- Not covered here (deliberately, out of this task's scope): dict_type is
-- equally load-bearing and equally unguarded — the same trigger could raise
-- on it in one more line. Left for its own task rather than folded in;
-- see docs/deferred-tasks.md (bb).

create function public.forbid_dictionary_code_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception
      'dcs.dictionaries.code is immutable (% -> %): the code is a segment of the SCL document number, so changing it would retroactively alter existing numbers. Deactivate the entry (is_active = false) and create a new one instead.',
      old.code, new.code
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.forbid_dictionary_code_change() is
  'BEFORE UPDATE row trigger for dcs.dictionaries: raises when code changes. '
  'Unconditional — no role bypass, including admin (DCS 1a.15b).';

-- SECURITY INVOKER (the default): raising an exception needs no elevated
-- rights, so unlike audit_trigger() this adds no SECURITY DEFINER function to
-- advisor lint 0029. EXECUTE is revoked anyway — it is checked when the
-- trigger is created (as postgres), never when it fires, so no API role needs
-- it, and leaving the default grant in place would put the function in front
-- of anon (lint 0028, guarded by supabase/tests/advisor_grants.test.sql).
revoke execute on function public.forbid_dictionary_code_change()
  from public, anon, authenticated, service_role;

-- Fires before set_updated_at (BEFORE UPDATE triggers run in name order:
-- dictionaries_code_immutable < set_updated_at) and, being BEFORE, before the
-- AFTER-trigger audit_dictionaries — so a rejected code change leaves no
-- audit_log row and no updated_at bump.
create trigger dictionaries_code_immutable
  before update on dcs.dictionaries
  for each row execute function public.forbid_dictionary_code_change();
