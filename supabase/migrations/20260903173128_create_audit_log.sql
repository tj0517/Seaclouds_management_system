-- DCS 1a.08: shared audit log (brief §5.9, §3.5) — one table, one generic
-- trigger function, attached to many tables. In a client dispute over delays
-- this is the only reliable trail, so it records who changed what, when and
-- from where, at the level of single fields (UPDATE) or whole rows
-- (INSERT/DELETE). Lives in public: it is core-layer infrastructure shared
-- by every module (ADR-0001/0003), not a DCS-internal table.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  user_id uuid,
  table_name text not null,
  record_id uuid not null,
  action text not null,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  ip text,
  project_id uuid,
  constraint audit_log_action_check check (action in ('INSERT', 'UPDATE', 'DELETE'))
);

comment on table public.audit_log is
  'Shared audit trail (brief §5.9). Written exclusively by the SECURITY '
  'DEFINER trigger public.audit_trigger(); no API role holds INSERT/UPDATE/'
  'DELETE on it. INSERT/DELETE = one row per record (field_name NULL, whole '
  'row in new_value/old_value); UPDATE = one row per column that actually '
  'changed. Retention policy is open question O-04.';
comment on column public.audit_log.user_id is
  'auth.uid() of the session that made the change; NULL for sessionless '
  'writes (seed, migration, psql). Deliberately no FK to profiles: the trail '
  'must outlive the account.';
comment on column public.audit_log.table_name is
  'Schema-qualified source table (public.projects, dcs.project_roles, …) — '
  'the trigger serves two schemas, so a bare name would be ambiguous.';
comment on column public.audit_log.field_name is
  'NULL for INSERT/DELETE (whole row); the single changed column for UPDATE.';
comment on column public.audit_log.ip is
  'Client IP from the x-forwarded-for header PostgREST exposes in '
  'request.headers (first address); NULL outside the PostgREST context.';
comment on column public.audit_log.project_id is
  'Project scope for the upcoming "DC reads own projects" policy (1a.09): '
  'for public.projects the row''s own id; for tables with a project_id column '
  '(dcs.project_roles) that column; NULL for tables with no natural project '
  'scope (public.profiles, public.clients). Deliberately no FK: the trail '
  'must survive project deletion.';

-- Read paths: history of one record, and (1a.09) everything in a project.
create index audit_log_table_name_record_id_occurred_at_idx
  on public.audit_log (table_name, record_id, occurred_at);
create index audit_log_project_id_occurred_at_idx
  on public.audit_log (project_id, occurred_at);

-- ------------------------------------------------------------------
-- Trigger function. SECURITY DEFINER because the writing session has no
-- INSERT right on audit_log (see revokes below) — the function inserts as
-- its owner (postgres, table owner, so RLS does not apply to it). Same
-- pinned search_path as set_updated_at() (20260831143840), hence every
-- reference below is schema-qualified.
-- ------------------------------------------------------------------
create function public.audit_trigger() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_table text := tg_table_schema || '.' || tg_table_name;
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_record_id uuid;
  v_project_id uuid;
  v_user_id uuid := auth.uid();
  v_headers text := current_setting('request.headers', true);
  v_ip text;
begin
  -- request.headers is set by PostgREST only; the `true` (missing_ok) above
  -- turns "no such setting" (seed, migration, psql) into NULL instead of an
  -- exception inside the trigger. x-forwarded-for may carry a proxy chain —
  -- the first address is the client.
  if v_headers is not null and v_headers <> '' then
    v_ip := nullif(btrim(split_part(v_headers::jsonb ->> 'x-forwarded-for', ',', 1)), '');
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  else
    v_new := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;
  v_row := coalesce(v_new, v_old);

  -- The only structural assumption: an `id uuid` primary key. Attach the
  -- trigger only to tables that have one (mdr_settings, PK = project_id,
  -- would need a dedicated branch here — it is out of scope for now).
  v_record_id := (v_row ->> 'id')::uuid;

  -- Project scope without per-table logic: projects itself, otherwise the
  -- row's project_id column when it has one, otherwise NULL.
  if v_table = 'public.projects' then
    v_project_id := v_record_id;
  elsif v_row ? 'project_id' then
    v_project_id := (v_row ->> 'project_id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    -- One row per column whose value actually changed (jsonb IS DISTINCT
    -- FROM, so NULL ↔ value counts as a change). updated_at is excluded: it
    -- changes on every write and would only flood the log. JSON null is
    -- stored as SQL NULL so consumers can test old_value/new_value IS NULL.
    insert into public.audit_log
      (user_id, table_name, record_id, action, field_name, old_value, new_value, ip, project_id)
    select v_user_id, v_table, v_record_id, 'UPDATE', k,
           nullif(v_old -> k, 'null'::jsonb), nullif(v_new -> k, 'null'::jsonb),
           v_ip, v_project_id
      from jsonb_object_keys(v_new) as k
     where k <> 'updated_at'
       and v_old ? k
       and (v_old -> k) is distinct from (v_new -> k)
     order by k;
  else
    insert into public.audit_log
      (user_id, table_name, record_id, action, field_name, old_value, new_value, ip, project_id)
    values (v_user_id, v_table, v_record_id, tg_op, null, v_old, v_new, v_ip, v_project_id);
  end if;

  return null; -- AFTER trigger: the return value is ignored
end;
$$;

comment on function public.audit_trigger() is
  'Generic AFTER INSERT/UPDATE/DELETE row trigger feeding public.audit_log. '
  'Requires an `id uuid` PK on the audited table. Attached tables: '
  'public.projects, dcs.project_roles, public.profiles, public.clients (DCS '
  '1a.08); dcs.dictionaries follows in 1a.07.';

-- Nobody calls this through the API: EXECUTE is checked when the trigger is
-- created (as postgres), not when it fires, so the API roles need no grant.
-- Without this revoke the default privileges would hand EXECUTE to
-- authenticated and add the function to advisor lint 0029.
revoke execute on function public.audit_trigger() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- Audited tables (brief §5.9 mandatory events: roles, cycle configuration,
-- reviewer composition, numbers/dates live in projects/project_roles;
-- profiles and clients are the identities those entries point at).
-- NOT attached: dcs.mdr_settings (not a mandatory audit event yet) and any
-- TES table (TES/DCS isolation) — both are explicit non-goals of 1a.08.
-- ------------------------------------------------------------------
create trigger audit_projects
  after insert or update or delete on public.projects
  for each row execute function public.audit_trigger();
create trigger audit_project_roles
  after insert or update or delete on dcs.project_roles
  for each row execute function public.audit_trigger();
create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();
create trigger audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.audit_trigger();

-- ------------------------------------------------------------------
-- Access: admins read everything; nobody writes through the API. The "DC
-- reads entries of own projects" policy needs is_doc_controller() (1a.09) —
-- docs/deferred-tasks.md. Two layers on writes: RLS with zero
-- INSERT/UPDATE/DELETE policies, plus the privileges themselves revoked so
-- that even service_role (which bypasses RLS) cannot alter the trail from
-- the app tier. Only postgres (migrations, retention job per O-04) can.
-- ------------------------------------------------------------------
alter table public.audit_log enable row level security;

create policy "Admins read audit log"
  on public.audit_log for select
  using ((select public.is_admin()));

-- TRUNCATE included: it is not subject to RLS, and the default privileges
-- would otherwise let service_role empty the trail in one statement.
revoke insert, update, delete, truncate on public.audit_log from authenticated, service_role;
