-- DCS 1a.17: one transaction that sets up a project MDR — public.projects +
-- dcs.mdr_settings + dcs.project_roles[] + public.sub_projects[] (CTR codes).
--
-- Why a function and not four inserts from the server action: the four rows
-- are one fact ("DCS now runs this project"). A client-side sequence would
-- leave a project with no mdr_settings, or a team with no CTR codes, whenever
-- the second call failed — and "roll it back by hand" is not a rollback, it is
-- a second chance to fail. A plpgsql function body runs inside the caller's
-- transaction, so one PostgREST /rpc/ call is one atomic unit: the duplicate
-- CTR code that aborts the last insert takes the project row with it.
-- See docs/01-architecture.md and CLAUDE.md ("Multi-table writes are one
-- Postgres function, one transaction").
--
-- Home: public, next to is_admin(), with a dcs_ prefix — the same placement
-- and naming as public.dcs_profile_directory() (1a.14b). It writes across both
-- schemas, so it belongs to neither; docs/02-data-model.md records public as
-- the established home for these cross-schema helpers.
--
-- SECURITY INVOKER, stated explicitly rather than left to the default:
--   * Every insert below executes as the caller (`authenticated` under
--     PostgREST), so the existing policies apply unchanged and untouched —
--     "Admin zarządza projektami" / "Admin zarządza kodami" /
--     "Admins manage mdr settings" / "Admins manage project roles" (read from
--     scl-dev 2026-09-11). The function can write nothing the caller could not
--     write by hand. RLS stays the control; this function is only the
--     transaction boundary.
--   * SECURITY DEFINER would be strictly worse here: none of the four tables
--     has FORCE ROW LEVEL SECURITY (read from scl-dev 2026-09-11:
--     relforcerowsecurity = false on all four), so a definer function owned by
--     postgres bypasses RLS entirely and the check below would become the only
--     barrier in front of four tables rather than a second one.
--   * Advisor: lint 0029 (authenticated_security_definer_function_executable)
--     counts SECURITY DEFINER functions only, so this adds none. The accepted
--     baseline stays 19 × 0027 + 12 × 0029 (read 2026-09-11; note
--     docs/03-conventions.md still says 10 × 0029 — stale since 1a.14b, see
--     docs/deferred-tasks.md (cc)).
--
-- Out of scope by the task, stated so the next reader does not go looking:
-- no policy on any of the four tables changes, creation stays admin-only, and
-- sub_projects keeps its per-project shape (project_id NOT NULL, UNIQUE
-- (project_id, code)) — O-06 is not resolved here.

create function public.dcs_create_project_mdr(
  p_project_code        text,
  p_name                text,
  p_process_type        public.project_process_type,
  p_year                integer,
  p_client_id           uuid    default null,
  p_cpy_numbering       boolean default false,
  p_cycle_idc_to_ifr    integer default 7,
  p_cycle_ifr_to_retcom integer default 10,
  p_cycle_retcom_to_ifc integer default 7,
  p_budget_hours        numeric default null,
  p_roles               jsonb   default '[]'::jsonb,
  p_ctr_codes           jsonb   default '[]'::jsonb
) returns uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  -- ------------------------------------------------------------------
  -- 1. Authorization. First statement in the body, before any validation
  --    and any write.
  --
  --    Unconditional: no DC branch (a dcs.project_roles row is per project,
  --    so nobody can be DC of a project that does not exist yet — that is
  --    exactly why creation is admin-only, see the 1a.16 decision in
  --    docs/02-data-model.md), no service_role branch, no bypass.
  --
  --    Under SECURITY INVOKER a non-admin is *also* stopped by RLS at the
  --    first insert, with the same SQLSTATE 42501. This check is not
  --    therefore redundant: it makes the refusal happen before any work,
  --    gives a message that names the rule instead of a policy, and is what
  --    still refuses if this function is ever switched to SECURITY DEFINER.
  --    supabase/tests/dcs_create_project_mdr.test.sql asserts the message,
  --    not just the SQLSTATE, precisely to prove which of the two fired.
  -- ------------------------------------------------------------------
  if not (select public.is_admin()) then
    raise exception
      'dcs_create_project_mdr: only an administrator may create a project MDR (public.profiles.role = ''admin''). Caller: %.',
      coalesce(auth.uid()::text, '<no session>')
      using errcode = 'insufficient_privilege';
  end if;

  -- ------------------------------------------------------------------
  -- 2. The one invariant the database does not already own.
  --
  --    docs/02-data-model.md states it in prose — "projects.client_id
  --    nullable (NULL = projekt wewnętrzny, process_type = Internal)" — but
  --    no constraint enforces it, and CPY numbering is meaningless without a
  --    client (docs/00-glossary.md: the CPY track is the *client's*
  --    numbering). The wizard skips the client step for Internal, so this
  --    only ever fires on a hand-made RPC call.
  --
  --    Raises rather than coercing: silently nulling a caller's client_id
  --    would be the same class of quiet rewrite as the omitted-field bug in
  --    docs/deferred-tasks.md (bb).
  --
  --    Everything else is left to the constraints that already exist, so
  --    there is no second copy of a rule to drift: project_code format
  --    (projects_project_code_format, 23514), code uniqueness
  --    (unique_project_code, 23505), the three cycle CHECKs and the
  --    budget_hours CHECK on dcs.mdr_settings (23514), CTR uniqueness within
  --    the project (sub_projects_project_id_code_key, 23505), the
  --    dcs.project_role enum cast (22P02) and the profiles FK on user_id
  --    (23503).
  -- ------------------------------------------------------------------
  if p_process_type = 'internal' and (p_client_id is not null or coalesce(p_cpy_numbering, false)) then
    raise exception
      'dcs_create_project_mdr: an internal project has no client and no CPY numbering (got client_id = %, cpy_numbering = %). NULL client_id is what makes a project internal — docs/02-data-model.md.',
      coalesce(p_client_id::text, 'null'), coalesce(p_cpy_numbering::text, 'null')
      using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------------
  -- 3. The four writes, in the order the acceptance criteria depend on:
  --    projects → mdr_settings → project_roles → sub_projects. CTR codes go
  --    LAST on purpose, so that the duplicate-code failure the atomicity
  --    proof uses is a failure at the last step — the case where a
  --    non-transactional implementation would already have committed the
  --    other three.
  -- ------------------------------------------------------------------
  insert into public.projects (name, project_code, client_id, process_type, year)
  values (p_name, p_project_code, p_client_id, p_process_type, p_year)
  returning id into v_project_id;

  -- A row here means "DCS runs this project" (docs/02-data-model.md). The
  -- defaults 7/10/7 live on the columns; passing them explicitly keeps the
  -- wizard's three fields the single source of what was chosen.
  insert into dcs.mdr_settings (
    project_id, cpy_numbering,
    cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc,
    budget_hours
  )
  values (
    v_project_id, coalesce(p_cpy_numbering, false),
    p_cycle_idc_to_ifr, p_cycle_ifr_to_retcom, p_cycle_retcom_to_ifc,
    p_budget_hours
  );

  -- One row per (user, role) pair — the same person may hold several roles
  -- in one project (docs/02-data-model.md). assigned_by comes from the
  -- session, as it does in grantProjectRole (1a.06). No DC in the payload is
  -- allowed on purpose: the wizard warns, it does not block.
  insert into dcs.project_roles (project_id, user_id, role, assigned_by)
  select
    v_project_id,
    (entry ->> 'user_id')::uuid,
    (entry ->> 'role')::dcs.project_role,
    auth.uid()
  from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb)) as entry;

  -- CTR codes. A project's codes cannot pre-exist (the project itself is one
  -- statement old), so this step only ever creates. Duplicates inside the
  -- payload are caught by sub_projects_project_id_code_key, not by a check
  -- here — one owner per rule.
  insert into public.sub_projects (project_id, code, description)
  select
    v_project_id,
    entry ->> 'code',
    nullif(entry ->> 'description', '')
  from jsonb_array_elements(coalesce(p_ctr_codes, '[]'::jsonb)) as entry;

  return v_project_id;
end;
$$;

comment on function public.dcs_create_project_mdr(
  text, text, public.project_process_type, integer, uuid, boolean,
  integer, integer, integer, numeric, jsonb, jsonb
) is
  'DCS 1a.17: creates a project MDR — public.projects + dcs.mdr_settings + '
  'dcs.project_roles[] + public.sub_projects[] — in one transaction, and '
  'returns the new project id. SECURITY INVOKER: every insert runs under the '
  'caller''s RLS, so this adds no privilege, only atomicity. Admin-only, '
  'checked in the body (42501) as well as by the policies. p_roles is '
  '[{"user_id": uuid, "role": dcs.project_role}, …]; p_ctr_codes is '
  '[{"code": text, "description": text}, …].';

-- The default privileges set by 20260831143841_revoke_anon_and_public_grants
-- already keep anon and PUBLIC off every new function in this schema. Pinned
-- explicitly anyway, next to what threatens it — that migration's own
-- reasoning for re-asserting the grants it cares about.
revoke execute on function public.dcs_create_project_mdr(
  text, text, public.project_process_type, integer, uuid, boolean,
  integer, integer, integer, numeric, jsonb, jsonb
) from public, anon;

-- authenticated calls this directly over /rest/v1/rpc/, like
-- dcs_profile_directory() and resubmit_rejected(). It is SECURITY INVOKER, so
-- the grant confers nothing beyond the caller's own table privileges and RLS.
grant execute on function public.dcs_create_project_mdr(
  text, text, public.project_process_type, integer, uuid, boolean,
  integer, integer, integer, numeric, jsonb, jsonb
) to authenticated;
