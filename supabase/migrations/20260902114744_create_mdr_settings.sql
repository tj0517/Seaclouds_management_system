-- DCS 1a.05: first dcs.* table — per-project MDR configuration (1:1 with
-- public.projects, PK = project_id). Documents inherit cycle lengths and
-- numbering mode from here (brief §5.1–5.2).

create type dcs.mdr_status as enum ('active', 'closed');

create table dcs.mdr_settings (
  project_id uuid primary key references public.projects (id) on delete cascade,
  cpy_numbering boolean not null default false,
  cycle_idc_to_ifr integer not null default 7,
  cycle_ifr_to_retcom integer not null default 10,
  cycle_retcom_to_ifc integer not null default 7,
  budget_hours numeric,
  status dcs.mdr_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mdr_settings_cycle_idc_to_ifr_positive check (cycle_idc_to_ifr > 0),
  constraint mdr_settings_cycle_ifr_to_retcom_positive check (cycle_ifr_to_retcom > 0),
  constraint mdr_settings_cycle_retcom_to_ifc_positive check (cycle_retcom_to_ifc > 0),
  constraint mdr_settings_budget_hours_non_negative check (budget_hours >= 0)
);

comment on table dcs.mdr_settings is
  'MDR configuration, 1:1 with public.projects. A missing row means "DCS does '
  'not run this project" — rows are NOT created for existing projects; one '
  'appears when a project MDR is set up in DCS (1a.17). ON DELETE CASCADE: '
  'settings without their project are meaningless leftovers, and project '
  'deletion is already admin-gated in TES.';
comment on column dcs.mdr_settings.status is
  'MDR lifecycle (documentation open/closed) — deliberately separate from '
  'projects.is_active, which governs hour logging in TES (O-13).';

create trigger set_updated_at
  before update on dcs.mdr_settings
  for each row execute function public.set_updated_at();

alter table dcs.mdr_settings enable row level security;

-- Same model as public.projects/clients for now: every signed-in user can
-- read, only admins write. The DC role arrives with dcs.project_members
-- (1a.06/1a.09) — write policies widen then.
create policy "Authenticated users can read mdr settings"
  on dcs.mdr_settings for select
  using ((select auth.role()) = 'authenticated');

create policy "Admins manage mdr settings"
  on dcs.mdr_settings for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
