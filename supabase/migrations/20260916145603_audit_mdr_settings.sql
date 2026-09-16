-- DCS 1a.17b: audit trail for dcs.mdr_settings — the per-project MDR
-- parameters (review cycle 7/10/7, cpy_numbering, budget_hours, status).
-- Until now the only witness to a cycle change was mdr_settings.updated_at,
-- which says "something changed at this hour" and nothing else; brief §5.2
-- treats the cycle as a project attribute documents inherit, and Phase 2
-- computes Planned dates from it, so "who shortened the cycle from 10 days to
-- 3" is a question that will be asked. Parked as item (dd) in
-- docs/deferred-tasks.md when 1a.17 shipped.
--
-- The table was left out of 1a.08 for a structural reason, not an oversight:
-- public.audit_trigger() took record_id from an `id uuid` primary key, and
-- dcs.mdr_settings is keyed by project_id with no `id` column at all. With the
-- trigger attached and the function untouched, every UPDATE on the table dies
-- with 23502 (null value in column "record_id") — verified locally before
-- this migration was written.
--
-- Design (no ADR — this is the shape docs/deferred-tasks.md (dd) and the
-- public.audit_log section of docs/02-data-model.md already anticipated):
-- ONE branch inside the shared function, resolving record_id by row SHAPE
-- (coalesce id → project_id), not a second trigger function and not a list of
-- table names. Rationale: a dedicated copy would duplicate ~60 lines of diff
-- logic that must then be changed twice forever (retention O-04, any new
-- audit_log column), and a `if v_table = '...'` list starts a table that
-- grows; resolving by shape means a future dcs.* table keyed by project_id is
-- audited by attaching the trigger alone. project_id needed no change: the
-- existing `elsif v_row ? 'project_id'` branch already resolves it.
--
-- Everything below the record_id assignment is 20260903173128_create_audit_log
-- reproduced byte-for-byte (verified by md5 of the function body against
-- pg_get_functiondef on scl-dev, 2026-09-16). create or replace, so the six
-- triggers already executing this function keep working and keep their
-- behaviour: all six audited tables have an `id`, so coalesce returns the
-- first argument exactly as the old expression did.

create or replace function public.audit_trigger() returns trigger
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

  -- Record identity by row shape, not by table name (1a.17b): the `id uuid`
  -- primary key every table carried until now, falling back to project_id for
  -- a table keyed by it (dcs.mdr_settings, PK = project_id, 1:1 with the
  -- project). For the six tables audited before 1a.17b the coalesce returns
  -- exactly what the old expression returned — they all have an `id`. A table
  -- with neither key still fails loudly on the NOT NULL of record_id (23502)
  -- rather than logging a row nobody can trace back: that is deliberate.
  v_record_id := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'project_id')::uuid);

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
  'record_id is resolved by row shape: the `id uuid` PK when the table has '
  'one, otherwise project_id for a table keyed by it (dcs.mdr_settings). A '
  'table with neither raises 23502 on audit_log.record_id — by design, an '
  'untraceable trail entry is worse than a failed write. Attached tables: '
  'public.projects, dcs.project_roles, public.profiles, public.clients (DCS '
  '1a.08), dcs.dictionaries (1a.07), public.module_permissions (1a.22), '
  'dcs.mdr_settings (1a.17b).';

-- create or replace preserves the existing ACL, so the 1a.08 revoke still
-- holds — re-issued here as insurance, and because a reader of this file
-- should not have to open another migration to know the function is not
-- callable through the API. REVOKE on a privilege that is already absent is a
-- no-op, so this is safe to run on an environment that has either state.
revoke execute on function public.audit_trigger() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- The seventh audited table. Same shape and naming as the six from
-- 1a.08/1a.07/1a.22. UPDATE writes one row per column that actually changed,
-- with updated_at excluded — so the set_updated_at trigger already on this
-- table does not flood the log, and a no-op UPDATE writes nothing at all.
-- record_id = project_id = the project this MDR configuration belongs to,
-- which also puts these entries inside the "DC reads own project audit log"
-- policy from 1a.09 without any extra work.
-- ------------------------------------------------------------------
create trigger audit_mdr_settings
  after insert or update or delete on dcs.mdr_settings
  for each row execute function public.audit_trigger();
