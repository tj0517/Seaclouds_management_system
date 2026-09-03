-- DCS 1a.09: helper functions that turn dcs.project_roles into authorization
-- decisions, and the RLS policies that use them (brief §3.5: authorization in
-- the database, not in Next.js). Earlier tasks left several policies
-- deliberately narrow because these functions did not exist yet:
-- project_roles (1a.06: own rows only), clients (1a.04: every signed-in
-- user), mdr_settings (1a.05: admin writes only), audit_log (1a.08: admin
-- reads only). This migration widens exactly those.
--
-- All three functions are SECURITY DEFINER with search_path = '' and every
-- identifier schema-qualified (they cross public/dcs). SECURITY DEFINER is
-- required, not optional: a policy on dcs.project_roles that read
-- dcs.project_roles under RLS would recurse (ADR-0008). Like is_admin(), they
-- are invoked from policy expressions as the querying role, so
-- `authenticated` must hold EXECUTE (accepted lint 0029, docs/03-conventions).

-- ------------------------------------------------------------------
-- Functions (public, next to is_admin(); its body is untouched)
-- ------------------------------------------------------------------

-- "Belongs to the project" in the widest sense shared by both modules:
-- logs hours on it (TES project_assignments) OR holds a DCS role in it.
create function public.is_project_member(p_project_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.project_assignments pa
     where pa.project_id = p_project_id
       and pa.user_id = auth.uid()
  ) or exists (
    select 1 from dcs.project_roles pr
     where pr.project_id = p_project_id
       and pr.user_id = auth.uid()
  );
$$;

create function public.has_project_role(p_project_id uuid, p_roles dcs.project_role[])
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from dcs.project_roles pr
     where pr.project_id = p_project_id
       and pr.user_id = auth.uid()
       and pr.role = any (p_roles)
  );
$$;

create function public.is_doc_controller(p_project_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.has_project_role(p_project_id, array['dc']::dcs.project_role[]);
$$;

comment on function public.is_project_member(uuid) is
  'auth.uid() has a public.project_assignments row (TES) or a dcs.project_roles '
  'row (DCS) for the project. SECURITY DEFINER: used by policies on '
  'dcs.project_roles itself (ADR-0008).';
comment on function public.has_project_role(uuid, dcs.project_role[]) is
  'auth.uid() holds any of the given DCS roles in the project (dcs.project_roles).';
comment on function public.is_doc_controller(uuid) is
  'has_project_role(project, {dc}) — the brief''s Document Controller of that project.';

-- Policies evaluate as the querying role, so authenticated needs EXECUTE
-- (same as is_admin, pinned by 20260831143841). Nothing for anon/PUBLIC.
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.has_project_role(uuid, dcs.project_role[]) to authenticated;
grant execute on function public.is_doc_controller(uuid) to authenticated;
revoke execute on function public.is_project_member(uuid) from anon, public;
revoke execute on function public.has_project_role(uuid, dcs.project_role[]) from anon, public;
revoke execute on function public.is_doc_controller(uuid) from anon, public;

-- ------------------------------------------------------------------
-- dcs.project_roles: the whole project team reads the team's roles; the
-- project's DC manages them without global admin. "Admins manage project
-- roles" (1a.06) stays as is.
-- ------------------------------------------------------------------
drop policy "Users read own project roles" on dcs.project_roles;

create policy "Project members read project roles"
  on dcs.project_roles for select
  using (public.is_project_member(project_id));

create policy "Doc controllers manage project roles"
  on dcs.project_roles for all
  using (public.is_doc_controller(project_id))
  with check (public.is_doc_controller(project_id));

-- ------------------------------------------------------------------
-- public.clients: read only by admins and by members of a project of that
-- client; writes stay admin-only ("Admins manage clients", 1a.04, kept).
-- Notion says "admin/DC" for writes, but a client can span several projects
-- while DC is per project — "which DC" is undefined until Phase 4 settles
-- the client–project relationship.
-- ------------------------------------------------------------------
drop policy "Authenticated users can read clients" on public.clients;

create policy "Members of client projects read clients"
  on public.clients for select
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.projects p
       where p.client_id = clients.id
         and public.is_project_member(p.id)
    )
  );

-- ------------------------------------------------------------------
-- dcs.mdr_settings: the project's DC configures cycles/budget/status
-- (Notion "cycle/budget: admin/DC only" — those columns live here, not on
-- public.projects). Existing admin ALL and authenticated SELECT policies
-- are untouched.
-- ------------------------------------------------------------------
create policy "Doc controllers manage mdr settings"
  on dcs.mdr_settings for all
  using (public.is_doc_controller(project_id))
  with check (public.is_doc_controller(project_id));

-- ------------------------------------------------------------------
-- public.audit_log: the DC reads the trail of their own projects. Rows with
-- project_id NULL (profiles, clients) stay admin-only by the 1a.08 design.
-- "Admins read audit log" is untouched; writes remain impossible via the API.
-- ------------------------------------------------------------------
create policy "Doc controllers read own project audit log"
  on public.audit_log for select
  using (project_id is not null and public.is_doc_controller(project_id));
