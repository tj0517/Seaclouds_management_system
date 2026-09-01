-- Shared client registry for the core layer (brief §3.2, DCS 1a.04).
-- The client of a project drives CPY numbering (§6.3) and, in Phase 4, gets
-- portal access. Lives in public, not dcs: the core layer is the existing
-- public schema (ADR-0001), and clients will be referenced by TES-owned
-- projects, so it is shared infrastructure, not a DCS-internal table
-- (ADR-0003).

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  contact_email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint clients_name_not_blank check (btrim(name) <> ''),
  constraint clients_code_format check (code ~ '^[A-Z0-9]{2,10}$'),
  constraint clients_code_key unique (code)
);

comment on table public.clients is
  'Shared client registry (core layer, brief §3.2). Deactivate clients '
  '(is_active = false) instead of deleting them — projects.client_id is '
  'ON DELETE RESTRICT, mirroring the active-flag convention of the DCS '
  'dictionaries.';
comment on constraint clients_code_format on public.clients is
  'code becomes a segment of hyphen-separated DCS document numbers (CPY '
  'numbering, brief §6.3), so it is uppercase A-Z/0-9 only, 2-10 chars, '
  'with no separators — a hyphen inside the code would make document '
  'numbers unparseable. Unique so a code identifies exactly one client.';

alter table public.clients enable row level security;

-- Same access model as public.projects (Widoczność projektów / Admin
-- zarządza projektami): every signed-in user reads, only admins write.
-- Rationale for using this model instead of per-project-membership SELECT:
-- docs/02-data-model.md, section public.clients.
create policy "Authenticated users can read clients"
  on public.clients for select
  using ((select auth.role()) = 'authenticated');

create policy "Admins manage clients"
  on public.clients for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Nullable FK: internal projects (process_type = Internal per brief §5.2)
-- have no client. RESTRICT, not SET NULL: deleting a client must not
-- silently reclassify its projects as internal — deactivate the client
-- instead.
alter table public.projects
  add column client_id uuid references public.clients (id) on delete restrict;

comment on column public.projects.client_id is
  'Client of the project (public.clients). NULL = internal project. '
  'FK is ON DELETE RESTRICT — deactivate clients, do not delete them.';

create index projects_client_id_idx on public.projects (client_id);
