-- DCS 1a.09b: DC write policies on dcs.dictionaries — closes the gap left by
-- 1a.09, which added Doc Controller write access to dcs.project_roles and
-- dcs.mdr_settings but left dcs.dictionaries admin-only (brief §5.8, §9.6:
-- the DC manages dictionaries from the admin panel without a developer).
--
-- dcs.dictionaries has no project_id (company-wide by design, 1a.07), so
-- is_doc_controller(p_project_id) cannot be used here. This migration adds a
-- project-less counterpart, public.is_any_doc_controller(), mirroring
-- is_doc_controller exactly (SECURITY DEFINER, search_path = '', schema-
-- qualified enum cast, EXECUTE to authenticated only) — 1a.11 needs the same
-- predicate again, so it lives in a function rather than being inlined.
--
-- DELETE stays admin-only: dictionary codes become part of document numbers;
-- 1a.15 deactivates via is_active instead of deleting. The two existing
-- policies ("Authenticated users can read dictionaries", "Admins manage
-- dictionaries") are untouched — these are additional permissive policies.
--
-- The predicate is wrapped in a subselect ((select public.is_any_doc_controller()))
-- to match the InitPlan style already used by "Admins manage dictionaries"
-- (evaluated once per query, not once per row) and avoid an auth_rls_initplan
-- advisor warning.
--
-- Written as two single-command policies (INSERT / UPDATE) rather than one
-- FOR ALL, and without a WHERE clause, so 1a.11 can later `alter policy`
-- each one to add an aal2 condition without dropping and recreating it.

create function public.is_any_doc_controller() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from dcs.project_roles pr
     where pr.user_id = auth.uid()
       and pr.role = 'dc'::dcs.project_role
  );
$$;

comment on function public.is_any_doc_controller() is
  'auth.uid() holds the dc role on any project (dcs.project_roles) — the '
  'project-less counterpart to is_doc_controller(uuid), for tables like '
  'dcs.dictionaries that have no project_id.';

grant execute on function public.is_any_doc_controller() to authenticated;
revoke execute on function public.is_any_doc_controller() from anon, public;

-- ------------------------------------------------------------------
-- dcs.dictionaries: DC INSERT and UPDATE, in addition to admin ALL. DELETE
-- stays admin-only ("Admins manage dictionaries", untouched).
-- ------------------------------------------------------------------
create policy "Doc controllers insert dictionaries"
  on dcs.dictionaries for insert
  with check ((select public.is_any_doc_controller()));

create policy "Doc controllers update dictionaries"
  on dcs.dictionaries for update
  using ((select public.is_any_doc_controller()))
  with check ((select public.is_any_doc_controller()));
