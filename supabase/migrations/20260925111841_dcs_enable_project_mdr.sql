-- DCS 1b.24: "Enable DCS" for a project that already exists in Timesheet —
-- an admin-only function that inserts dcs.mdr_settings + dcs.project_roles[]
-- for an EXISTING public.projects row, in one transaction, and touches
-- neither public.projects nor public.sub_projects.
--
-- Why a separate function rather than reusing dcs_create_project_mdr: that
-- function's very first write is `insert into public.projects` — there is no
-- way to skip it and keep the transaction one call. Client agreement
-- (tj 2026-09-25, docs/tasks/DCS-1b.24.md): DCS no longer creates projects at
-- all, it only enables itself on projects Timesheet already owns. Shared
-- fields (code, name, client, process type, year) stay Timesheet's, display
-- -only in DCS until the portal admin exists (docs/adr/0014-portal-admin.md).
--
-- dcs_create_project_mdr itself is untouched by this migration and stays in
-- the database — dropping it is a separate, gated task (recorded in
-- docs/deferred-tasks.md).
--
-- SECURITY INVOKER, same reasoning as dcs_create_project_mdr: every insert
-- below runs under the caller's RLS ("Admins manage mdr settings" / "Admins
-- manage project roles", both ALL — read from scl-dev and prod 2026-09-25),
-- so the function adds no privilege beyond atomicity. Neither table has FORCE
-- ROW LEVEL SECURITY, so SECURITY DEFINER would only remove a barrier here,
-- not add one — the same argument the original migration made.
--
-- No policy on dcs.mdr_settings or dcs.project_roles changes: the admin ALL
-- policies already cover this INSERT. (Noticed, not fixed here, and recorded
-- in docs/deferred-tasks.md: "Doc controllers manage mdr settings" is also
-- ALL, so a DC can DELETE their own project's mdr_settings row today — i.e.
-- turn DCS back off. Out of scope for this task.)

create function public.dcs_enable_project_mdr(
  p_project_id          uuid,
  p_cpy_numbering       boolean default false,
  p_cycle_idc_to_ifr    integer default 7,
  p_cycle_ifr_to_retcom integer default 10,
  p_cycle_retcom_to_ifc integer default 7,
  p_budget_hours        numeric default null,
  p_roles               jsonb   default '[]'::jsonb
) returns uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  -- ------------------------------------------------------------------
  -- 1. Authorization. First statement, unconditional — same shape and same
  --    reasoning as dcs_create_project_mdr: under SECURITY INVOKER a
  --    non-admin is also stopped by RLS at the first insert with the same
  --    42501, so this check exists to fire before any work and to name the
  --    rule in its message. supabase/tests/dcs_enable_project_mdr.test.sql
  --    asserts the message, not only the SQLSTATE.
  -- ------------------------------------------------------------------
  if not (select public.is_admin()) then
    raise exception
      'dcs_enable_project_mdr: only an administrator may enable DCS for a project (public.profiles.role = ''admin''). Caller: %.',
      coalesce(auth.uid()::text, '<no session>')
      using errcode = 'insufficient_privilege';
  end if;

  -- ------------------------------------------------------------------
  -- 2. The project must exist. Enabling DCS never creates a project — that
  --    is the whole point of this task versus dcs_create_project_mdr.
  -- ------------------------------------------------------------------
  select client_id into v_client_id from public.projects where id = p_project_id;
  if not found then
    raise exception
      'dcs_enable_project_mdr: no project with id % — enabling DCS never creates a project, only Timesheet does.',
      p_project_id
      using errcode = 'no_data_found';
  end if;

  -- ------------------------------------------------------------------
  -- 3. Refuse a project that already has DCS enabled. dcs.mdr_settings.
  --    project_id is the primary key, so a second insert would fail on its
  --    own (23505) — raised explicitly first so the message says which rule
  --    fired rather than leaving the caller to infer it from a bare PK
  --    violation. apps/dcs/lib/project-mdr.ts's mapDbError matches this
  --    message text to keep the two 23505 causes ("already enabled" vs a
  --    genuine PK race) apart.
  -- ------------------------------------------------------------------
  if exists (select 1 from dcs.mdr_settings where project_id = p_project_id) then
    raise exception
      'dcs_enable_project_mdr: DCS is already enabled for project % — this function only enables DCS once, it does not reconfigure it.',
      p_project_id
      using errcode = 'unique_violation';
  end if;

  -- ------------------------------------------------------------------
  -- 4. CPY numbering needs a client. Stricter than dcs_create_project_mdr's
  --    internal-only check (client agreement, tj 2026-09-25,
  --    docs/tasks/DCS-1b.24.md): on prod, 7 of 8 projects have no client and
  --    5 of those also have no process_type, so keying the rule on
  --    process_type would leave CPY numbering undecidable for most of them.
  --    client_id is the one field the CPY track (docs/00-glossary.md: the
  --    client's own numbering) actually depends on.
  -- ------------------------------------------------------------------
  if coalesce(p_cpy_numbering, false) and v_client_id is null then
    raise exception
      'dcs_enable_project_mdr: CPY numbering needs a client, and this project has none (docs/00-glossary.md: the CPY track is the client''s numbering).'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------------
  -- 5. The two writes this function is for. Deliberately NOT touching
  --    public.projects or public.sub_projects — a project's identity and its
  --    CTR codes stay Timesheet's, unchanged by enabling DCS.
  -- ------------------------------------------------------------------
  insert into dcs.mdr_settings (
    project_id, cpy_numbering,
    cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc,
    budget_hours
  )
  values (
    p_project_id, coalesce(p_cpy_numbering, false),
    p_cycle_idc_to_ifr, p_cycle_ifr_to_retcom, p_cycle_retcom_to_ifc,
    p_budget_hours
  );

  -- One row per (user, role) pair, exactly like dcs_create_project_mdr. An
  -- empty p_roles (no DC) is accepted here too — the wizard is where "at
  -- least one DC" is enforced (task decision, tj 2026-09-25), not the
  -- database, matching how dcs_create_project_mdr already treats "no DC" as
  -- a warning rather than a block.
  insert into dcs.project_roles (project_id, user_id, role, assigned_by)
  select
    p_project_id,
    (entry ->> 'user_id')::uuid,
    (entry ->> 'role')::dcs.project_role,
    auth.uid()
  from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb)) as entry;

  return p_project_id;
end;
$$;

comment on function public.dcs_enable_project_mdr(
  uuid, boolean, integer, integer, integer, numeric, jsonb
) is
  'DCS 1b.24: enables DCS on an EXISTING project — dcs.mdr_settings + '
  'dcs.project_roles[] — in one transaction, and returns the project id. '
  'Never writes public.projects or public.sub_projects. SECURITY INVOKER: '
  'every insert runs under the caller''s RLS, so this adds no privilege, '
  'only atomicity. Admin-only, checked in the body (42501) as well as by the '
  'policies. Refuses a project that does not exist (P0002) or one that '
  'already has DCS enabled (23505). CPY numbering requires client_id is not '
  'null (22023). p_roles is [{"user_id": uuid, "role": dcs.project_role}, …].';

-- Same defaults as dcs_create_project_mdr: anon/PUBLIC already lose execute
-- by default (20260831143841_revoke_anon_and_public_grants), pinned here
-- explicitly next to what threatens it.
revoke execute on function public.dcs_enable_project_mdr(
  uuid, boolean, integer, integer, integer, numeric, jsonb
) from public, anon;

grant execute on function public.dcs_enable_project_mdr(
  uuid, boolean, integer, integer, integer, numeric, jsonb
) to authenticated;
