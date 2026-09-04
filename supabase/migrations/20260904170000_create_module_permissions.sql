-- DCS 1a.22: per-user, per-module access flag (TES / DCS / BMS). Source:
-- client plan item 1a.03, missing from the data model until now. This is the
-- authorization layer 1a.23 will use to hide a module tile the user may not
-- open, and the eventual home of the "who counts as administrative" question
-- surfaced in 1a.11 — but consuming it from proxy.ts/admin/layout.tsx is
-- explicitly a separate, later task; this migration only creates the table.
--
-- Shape: presence, not a boolean column. A row (user_id, module) means
-- "granted"; its absence means "not granted". Chosen over one row per
-- user x module with an `enabled` boolean because the default for a new
-- user (TES yes, DCS no, BMS no) then falls out of "insert one row" instead
-- of "insert three rows, two of them false" — fewer rows, and "does this
-- user have DCS" is `exists`, not `exists ... and enabled`.
--
-- portal_module: an enum, not text + CHECK like dcs.dictionaries. Unlike
-- dict_type (an open, growing list where adding a value is meant to be an
-- ordinary migration), BMS is the last module named in the brief and the
-- module set is a small, stable, portal-wide concept (also used by 1a.13's
-- module switcher and 1a.23's portal tiles) — an enum documents that
-- closedness. Prefixed (not `module`) per docs/03-conventions.md: "module"
-- is generic enough to collide with an unrelated future meaning.
create type public.portal_module as enum ('tes', 'dcs', 'bms');

create table public.module_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module public.portal_module not null,
  granted_at timestamptz not null default now(),
  constraint module_permissions_user_id_module_key unique (user_id, module)
);

-- The one read every proxy.ts-style gate will make once this is consumed:
-- "does this user have module X".
create index module_permissions_user_id_idx on public.module_permissions (user_id);

comment on table public.module_permissions is
  'Per-user module access (TES/DCS/BMS), 1a.22. A row = granted; no row = '
  'not granted. Not yet consumed by any authorization gate (proxy.ts, '
  'admin/layout.tsx) — that is a separate task by design.';
comment on column public.module_permissions.module is
  'public.portal_module: tes | dcs | bms. Closed, portal-wide set — unlike '
  'dcs.dictionaries, a new value here is a deliberate product decision, not '
  'routine data, so it stays an enum.';
comment on column public.module_permissions.granted_at is
  'When the row was created. Who granted it, and any revocation, is in '
  'public.audit_log via the trigger below — not duplicated as a column here.';

-- Same generic trigger as the four 1a.08 tables and dcs.dictionaries
-- (1a.07); audit_trigger() is unchanged, module_permissions has the `id
-- uuid` PK it requires. No project_id column, so project_id lands NULL in
-- the log — same shape as public.profiles/public.clients.
create trigger audit_module_permissions
  after insert or update or delete on public.module_permissions
  for each row execute function public.audit_trigger();

alter table public.module_permissions enable row level security;

-- Every signed-in user reads their own grants (acceptance criterion 1).
create policy "Users read own module permissions"
  on public.module_permissions for select
  using ((select auth.uid()) = user_id);

-- Admin-only writes; the admin screen also needs to read every user's
-- grants, which this ALL policy covers together with the self-read policy
-- above (two permissive SELECT policies OR together).
create policy "Admins manage module permissions"
  on public.module_permissions for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ------------------------------------------------------------------
-- Default for newly created users (acceptance criterion 3): TES yes, DCS
-- no, BMS no, without anyone setting it manually. Fires on profiles INSERT
-- (both creation paths reach it — the auth.users trigger handle_new_user()
-- for self-signup, and an admin-invite upsert into profiles), independent
-- of and without modifying either. SECURITY DEFINER because the inserting
-- session (authenticated, or the trigger context of handle_new_user) has no
-- write policy on this table — same reasoning as audit_trigger().
-- ------------------------------------------------------------------
create function public.grant_default_module_access() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.module_permissions (user_id, module) values (new.id, 'tes');
  return new;
end;
$$;

comment on function public.grant_default_module_access() is
  'AFTER INSERT ON public.profiles: grants TES by default (1a.22). Does not '
  'grant DCS/BMS — those are admin-only, via the module permissions screen.';

revoke execute on function public.grant_default_module_access()
  from public, anon, authenticated, service_role;

create trigger grant_default_module_access
  after insert on public.profiles
  for each row execute function public.grant_default_module_access();

-- ------------------------------------------------------------------
-- Data migration for existing accounts (verified on prod 2026-09-04: 15
-- profiles, 2 admin, 13 employee, 0 project_lead). Runs once, now, over
-- whatever profiles already exist wherever this migration applies (dev,
-- later prod) — new profiles from this point on get TES from the trigger
-- above instead.
-- ------------------------------------------------------------------
insert into public.module_permissions (user_id, module)
select id, 'tes' from public.profiles;

insert into public.module_permissions (user_id, module)
select id, 'dcs' from public.profiles where role = 'admin';
