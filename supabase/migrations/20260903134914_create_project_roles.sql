-- DCS 1a.06: per-project DCS roles (brief §3), next to — not instead of —
-- public.project_assignments. The two tables carry different semantics:
-- project_assignments = "who logs hours on this project" (TES),
-- project_roles       = "what DCS role(s) a person holds in this project".
-- One person may hold several roles in one project and different roles in
-- different projects (ADR-0006). The global `admin` in profiles.role stays the
-- brief's ADM and is not duplicated here. Lives in schema dcs, not public —
-- ADR-0008.

create type dcs.project_role as enum ('orig', 'rev', 'chk', 'app', 'dc', 'view');

create table dcs.project_roles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  role dcs.project_role not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id),
  constraint project_roles_project_id_user_id_role_key unique (project_id, user_id, role)
);

-- Read paths of the upcoming role-based policies (1a.09): "does auth.uid()
-- hold role X in project Y" and "which projects does this user belong to".
create index project_roles_project_id_role_idx on dcs.project_roles (project_id, role);
create index project_roles_user_id_idx on dcs.project_roles (user_id);

comment on table dcs.project_roles is
  'DCS roles held per project (ORIG/REV/CHK/APP/DC/VIEW). Distinct from '
  'public.project_assignments (TES: who logs hours). A person may hold several '
  'roles in one project; (project_id, user_id, role) is unique. The global '
  'admin (profiles.role) is the brief''s ADM and is not stored here. '
  'ON DELETE CASCADE on project_id: roles without a project are meaningless.';
comment on column dcs.project_roles.assigned_by is
  'Who granted the role (set from the session by the server action); NULL '
  'for rows created outside the app (seed, migration).';

alter table dcs.project_roles enable row level security;

-- Deliberately narrow until 1a.09 introduces has_project_role() /
-- is_doc_controller(): a signed-in user sees their own role rows, admins see
-- and manage everything. Widening SELECT to "the whole project team" needs a
-- security-definer helper (a self-referencing policy would recurse), so it
-- arrives together with those functions, not here.
create policy "Users read own project roles"
  on dcs.project_roles for select
  using ((select auth.uid()) = user_id);

create policy "Admins manage project roles"
  on dcs.project_roles for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
