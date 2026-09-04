-- DCS 1a.07: one generic dictionary table for every DCS code list (brief
-- §5.8 — dictionaries live in the database, not in code, so a DC can manage
-- them from the admin panel without a deploy). Seven dictionary types share
-- the table; `dict_type` is text + CHECK, deliberately NOT an enum: the list
-- of types keeps growing in later phases, and adding one must be an ordinary
-- migration, not an ALTER TYPE behind a STOP gate. Content (appendices A/B)
-- is seeded by 1a.18; this migration delivers an empty, working table.
--
-- No project_id: dictionaries are company-wide by design (a code has one
-- meaning across all projects), so the "every dcs.* table carries project_id"
-- rule does not apply — see docs/02-data-model.md. audit_trigger() already
-- handles that shape (project_id → NULL, same as profiles/clients).

create table dcs.dictionaries (
  id uuid primary key default gen_random_uuid(),
  dict_type text not null,
  code text not null,
  label text not null,
  description text,
  meta jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dictionaries_dict_type_check check (dict_type in (
    'doc_type', 'discipline', 'area', 'language',
    'acceptance_code', 'workflow_status', 'workflow_step'
  )),
  constraint dictionaries_dict_type_code_key unique (dict_type, code)
);

-- The one lookup every form makes: active entries of one type, in order.
create index dictionaries_dict_type_active_sort_order_idx
  on dcs.dictionaries (dict_type, sort_order)
  where is_active;

comment on table dcs.dictionaries is
  'All DCS dictionaries (doc types, disciplines, areas, languages, acceptance '
  'codes, workflow statuses/steps) in one table, keyed by (dict_type, code). '
  'Rows are never deleted by the app: is_active = false hides an entry from '
  'forms while historical rows keep referencing it. Company-wide — no '
  'project_id on purpose. meta holds type-specific extras (e.g. default '
  'budget hours of a doc type, colour of a status) without schema changes.';
comment on column dcs.dictionaries.dict_type is
  'Dictionary the entry belongs to. text + CHECK, not an enum: new types are '
  'added by an ordinary migration extending the CHECK list.';
comment on column dcs.dictionaries.is_active is
  'false = hidden in forms, still readable (history must keep resolving).';

create trigger set_updated_at
  before update on dcs.dictionaries
  for each row execute function public.set_updated_at();

-- Same attachment as the four 1a.08 tables; audit_trigger() is unchanged.
create trigger audit_dictionaries
  after insert or update or delete on dcs.dictionaries
  for each row execute function public.audit_trigger();

alter table dcs.dictionaries enable row level security;

-- Every signed-in user reads every row, inactive ones included — forms
-- filter on is_active, the database keeps history resolvable.
create policy "Authenticated users can read dictionaries"
  on dcs.dictionaries for select
  using ((select auth.role()) = 'authenticated');

-- Admin-only writes, as decided for clients in 1a.09: the database does not
-- hand out a permission no screen uses yet. DC write access arrives with the
-- dictionary screen (1a.15) and would need a project-less
-- is_any_doc_controller() helper — deferred together with it.
create policy "Admins manage dictionaries"
  on dcs.dictionaries for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
