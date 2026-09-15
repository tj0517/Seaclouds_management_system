-- DCS 1a.17c: make public.projects.project_code immutable in the database.
--
-- Until now `project_code` was protected only by the DCS application: the type
-- UpdateProjectMdrInput (apps/dcs/lib/project-mdr.ts) carries no such field and
-- parseUpdateProjectMdrInput drops one present in a raw payload, and
-- apps/dcs/components/EditProjectDialog.tsx renders the field read-only.
-- None of that survives a call that does not go through that module: the
-- baseline policy "Admin zarządza projektami" grants ALL with is_admin() and
-- no column restriction (read from scl-dev 2026-09-15: polcmd '*', USING
-- is_admin(), WITH CHECK null), so any admin can PATCH
-- /rest/v1/projects?id=eq.… with {"project_code":"…"} today and succeed. The
-- project edit dialog in apps/timesheet offered exactly that as a form field
-- until this task; it is removed in the same PR.
--
-- This is the gap docs/deferred-tasks.md (ee) recorded, and the same one
-- 1a.15b closed for dcs.dictionaries.code with forbid_dictionary_code_change()
-- — for the same reason. project_code is already embedded in CTR codes
-- (SC2699_CTR100) and in timesheet history, and from 1b.02 it is the FIRST
-- segment of every SCL document number (SC2601-SCL-RA-0012-EN, PROJECT-ORIG-
-- TYPE-SEQ-LANG, docs/00-glossary.md), while dcs.documents keeps pointing at
-- the project by id — so a later code change would retroactively re-read every
-- number already issued.
--
-- Unconditional on purpose: no role branch, no admin bypass, no
-- session_replication_role escape, and no dated exception for TES. The UI must
-- never enforce a rule the database does not, and there is no reading of
-- "the code is the first segment of the document number" under which an admin
-- may change it. A project created with the wrong code is corrected by
-- creating the right one and deactivating the wrong one (is_active = false),
-- not by rewriting the code in place.
--
-- Note on ordering: the two earlier migrations that write this column
-- (20260901082600 backfilling '' / NULL to 'SCMS-IT', and 20260902114743
-- which only reads it in a WHERE) both run before this one, so a fresh
-- `supabase db reset` is unaffected. supabase/seed.sql and
-- public.dcs_create_project_mdr() only INSERT, and this trigger is UPDATE-only.

create function public.forbid_project_code_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.project_code is distinct from old.project_code then
    raise exception
      'public.projects.project_code is immutable (% -> %): the code is the first segment of the SCL document number and is embedded in CTR codes and timesheet history, so changing it would retroactively alter existing numbers. Create a new project with the correct code and deactivate this one (is_active = false) instead.',
      old.project_code, new.project_code
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.forbid_project_code_change() is
  'BEFORE UPDATE row trigger for public.projects: raises when project_code changes. '
  'Unconditional — no role bypass, including admin (DCS 1a.17c).';

-- SECURITY INVOKER (the default): raising an exception needs no elevated
-- rights, so unlike audit_trigger() this adds no SECURITY DEFINER function to
-- advisor lint 0029. EXECUTE is revoked anyway — it is checked when the
-- trigger is created (as postgres), never when it fires, so no API role needs
-- it, and leaving the default grant in place would put the function in front
-- of anon (lint 0028, guarded by supabase/tests/advisor_grants.test.sql).
revoke execute on function public.forbid_project_code_change()
  from public, anon, authenticated, service_role;

-- public.projects has exactly one trigger today, audit_projects (AFTER ROW
-- INSERT/UPDATE/DELETE → audit_trigger(); read from scl-dev 2026-09-15), and
-- no BEFORE trigger at all — so there is no name-ordering neighbour to sit
-- behind, and being BEFORE this one aborts ahead of audit_projects: a rejected
-- code change leaves no audit_log row. projects has no updated_at column, so
-- unlike dcs.dictionaries there is no set_updated_at to order against either.
create trigger projects_project_code_immutable
  before update on public.projects
  for each row execute function public.forbid_project_code_change();
