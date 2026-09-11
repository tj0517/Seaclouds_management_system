// DCS 1a.17: the Create Project MDR wizard and the DCS EditProjectDialog.
// Independent of Next.js (same split as lib/clients-admin.ts and
// lib/project-roles.ts): takes any typed Supabase client, so this runs from a
// server action (session client, RLS applies) and from a verification script.
// The 'use server' wrappers live in app/data/actions/project-mdr.ts.
//
// Creation is ONE call to public.dcs_create_project_mdr() (migration
// 20260911103639), never four inserts issued from here. Four PostgREST calls
// are four transactions: a failure on the third leaves a project with no CTR
// codes and no way to undo it from the client. The function is the
// transaction boundary; this module only marshals the payload and translates
// the database's errors into something the wizard can point at.
//
// The guard below is the app's own line of defence in front of RLS, not the
// control (CLAUDE.md). The database refuses a non-admin twice over — the
// in-body is_admin() check in the function, and the INSERT policies on all
// four tables — and keeps refusing if this file is bypassed entirely.
import type { SupabaseClient } from '@supabase/supabase-js'
import { Constants } from '@scl/db'
import type { Database, Enums, Json, Tables, TablesUpdate } from '@scl/db'
import { requireAdmin } from './clients-admin'
import type { ProjectRole } from './project-roles'
import { PROJECT_ROLES } from './project-roles'

export type ProcessType = Enums<'project_process_type'>
export type MdrStatus = Enums<{ schema: 'dcs' }, 'mdr_status'>
export type ProjectRow = Tables<'projects'>
export type MdrSettingsRow = Tables<{ schema: 'dcs' }, 'mdr_settings'>

/** Allowed values straight from the generated enums — never a hand-typed list. */
export const PROCESS_TYPES: readonly ProcessType[] = Constants.public.Enums.project_process_type
export const MDR_STATUSES: readonly MdrStatus[] = Constants.dcs.Enums.mdr_status

export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = {
  internal: 'Internal',
  tender: 'Tender',
  project: 'Project',
  course: 'Course',
}

export const MDR_STATUS_LABELS: Record<MdrStatus, string> = {
  active: 'Active',
  closed: 'Closed',
}

/**
 * The 7/10/7 review cycle (docs/00-glossary.md): IDC→IFR 7, IFR→RETCOM 10,
 * RETCOM→IFC 7 calendar days. These are also the column defaults on
 * dcs.mdr_settings; repeated here so the wizard can pre-fill its three fields
 * without a round trip, and so a changed default is one grep away from both.
 */
export const DEFAULT_CYCLE = {
  idcToIfr: 7,
  ifrToRetcom: 10,
  retcomToIfc: 7,
} as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Mirrors the DB CHECK projects_project_code_format (migration
 * 20260901082600) disjunct for disjunct:
 *   project_code ~ '^SC\d{4}$' OR project_code ~ '^SCMS' OR = 'SCC005'
 * Note the second is deliberately unanchored at the end (SCMS-IT, SCMS_TEST
 * both pass) and the third is a NAMED legacy exception, never a pattern — do
 * not relax it to /^SCC/ (see O-11). SCC005 can never actually be created
 * through the wizard, because unique_project_code already holds it; it stays
 * here only so this predicate is not stricter than the constraint it mirrors.
 */
export function isValidProjectCode(code: string): boolean {
  return /^SC\d{4}$/.test(code) || /^SCMS/.test(code) || code === 'SCC005'
}

export type ProjectMdrError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'invalid_project_code'
  | 'duplicate_project_code'
  | 'duplicate_ctr_code'
  | 'internal_project_has_client'
  | 'invalid_cycle'
  | 'invalid_budget'
  | 'unknown_user'
  | 'not_found'
  | 'db_error'

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProjectMdrError; message?: string }

export type RoleAssignmentInput = { userId: string; role: ProjectRole }
export type CtrCodeInput = { code: string; description: string | null }

export type CreateProjectMdrInput = {
  projectCode: string
  name: string
  processType: ProcessType
  year: number
  clientId: string | null
  cpyNumbering: boolean
  cycleIdcToIfr: number
  cycleIfrToRetcom: number
  cycleRetcomToIfc: number
  budgetHours: number | null
  roles: RoleAssignmentInput[]
  ctrCodes: CtrCodeInput[]
}

/**
 * `undefined` means "leave unchanged", `null` means "clear" — the distinction
 * updateProjectMdr's diff depends on, and the bug docs/deferred-tasks.md (bb)
 * recorded in updateDictionaryEntry (an omitted optional field silently
 * nulled out).
 *
 * Deliberately has no `projectCode` field, at the type level and again at
 * runtime in parseUpdateProjectMdrInput: project_code is the first segment of
 * every DCS document number (SC2601-SCL-RA-0012-EN, docs/00-glossary.md), so
 * changing it would retroactively alter existing numbers — the same argument
 * that made dcs.dictionaries.code immutable in 1a.15b. Unlike that one this
 * is app-level only; the database still permits the UPDATE (see the report's
 * "left unfixed" list).
 */
export type UpdateProjectMdrInput = {
  projectId: string
  name?: string
  clientId?: string | null
  /** `null` clears it back to "not classified" — the column is nullable (O-13 backfill left SCYYNN codes NULL). */
  processType?: ProcessType | null
  year?: number | null
  cpyNumbering?: boolean
  cycleIdcToIfr?: number
  cycleIfrToRetcom?: number
  cycleRetcomToIfc?: number
  budgetHours?: number | null
  status?: MdrStatus
}

export type ProjectMdr = {
  project: ProjectRow
  /** NULL means DCS does not run this project — no mdr_settings row (docs/02-data-model.md). */
  settings: MdrSettingsRow | null
}

type DbClient = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// Pure helpers — exported so the wizard validates live, in the same step the
// user is standing in, with the very code the server action re-runs. Vitest
// covers them directly (vitest.config.ts is node-only: no jsdom, so the
// decisions live here and the components stay thin, see components/IfRole.tsx).
// ---------------------------------------------------------------------------

function isProcessType(value: unknown): value is ProcessType {
  return typeof value === 'string' && (PROCESS_TYPES as readonly string[]).includes(value)
}

function isMdrStatus(value: unknown): value is MdrStatus {
  return typeof value === 'string' && (MDR_STATUSES as readonly string[]).includes(value)
}

function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLES as readonly string[]).includes(value)
}

/**
 * CTR codes repeated within one payload, in first-seen order, each listed
 * once however many times it occurs.
 *
 * Compared EXACTLY, not case-folded, because that is what
 * sub_projects_project_id_code_key does: 'ctr100' and 'CTR100' are two
 * distinct rows to the database, and a client-side check that disagreed with
 * the constraint would either block a legal payload or wave through one the
 * database then rejects mid-wizard.
 */
export function duplicateCtrCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const code of codes) {
    if (seen.has(code)) {
      if (!duplicates.includes(code)) duplicates.push(code)
    } else {
      seen.add(code)
    }
  }
  return duplicates
}

/**
 * The non-blocking warning from the wizard's "Team and roles" step: a project
 * with no Document Controller can be created, it just should not be created
 * silently. The DC is the only role that numbers documents and closes the
 * cycle (docs/00-glossary.md), and — per acceptance criterion 2 — the person
 * who will actually see this project on /dcs afterwards.
 */
export function hasDocController(roles: readonly RoleAssignmentInput[]): boolean {
  return roles.some((assignment) => assignment.role === 'dc')
}

/**
 * True when this process type has no client side at all — the wizard skips
 * its whole "Client" step, and both the payload and the database then carry
 * client_id = NULL / cpy_numbering = false (docs/02-data-model.md: a NULL
 * client_id is precisely what makes a project internal). The database raises
 * 22023 on a contradiction rather than coercing; this is the app half of the
 * same rule.
 */
export function skipsClientStep(processType: ProcessType): boolean {
  return processType === 'internal'
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function fail(error: ProjectMdrError, message?: string): { ok: false; error: ProjectMdrError; message?: string } {
  return { ok: false, error, message }
}

/**
 * Validates whatever an untrusted caller sends the create server action.
 *
 * Returns a typed error rather than `null` — the deliberate deviation from
 * parseCreateClientInput (lib/clients-admin.ts), which has one form and can
 * afford a flat 'invalid_input'. This one has six steps, and "invalid_input"
 * on a six-step wizard cannot tell the user which step to walk back to.
 */
export function parseCreateProjectMdrInput(raw: unknown): ActionResult<CreateProjectMdrInput> {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_input', 'payload is not an object')
  const r = raw as Record<string, unknown>

  // --- Step 1: identification -------------------------------------------
  if (typeof r.projectCode !== 'string' || r.projectCode.trim() === '') {
    return fail('invalid_project_code', 'project code is required')
  }
  const projectCode = r.projectCode.trim()
  if (!isValidProjectCode(projectCode)) {
    return fail('invalid_project_code', `"${projectCode}" is not SCYYNN (SC2601) or an SCMS code`)
  }
  if (typeof r.name !== 'string' || r.name.trim() === '') {
    return fail('invalid_input', 'project name is required')
  }
  if (!isProcessType(r.processType)) return fail('invalid_input', 'unknown process type')
  if (typeof r.year !== 'number' || !Number.isInteger(r.year)) {
    return fail('invalid_input', 'year must be a whole number')
  }

  // --- Step 2: client ----------------------------------------------------
  const clientId = r.clientId === undefined || r.clientId === null ? null : r.clientId
  if (clientId !== null && (typeof clientId !== 'string' || !UUID_RE.test(clientId))) {
    return fail('invalid_input', 'client id is not a uuid')
  }
  const cpyNumbering = r.cpyNumbering === undefined ? false : r.cpyNumbering
  if (typeof cpyNumbering !== 'boolean') return fail('invalid_input', 'cpyNumbering must be a boolean')

  // Mirrors the function's own 22023 raise. Checked here too so the wizard
  // can say which field is at fault without a round trip; the database stays
  // the enforcement either way.
  if (skipsClientStep(r.processType) && (clientId !== null || cpyNumbering)) {
    return fail(
      'internal_project_has_client',
      'an internal project has no client and no CPY numbering',
    )
  }

  // --- Step 3: review cycle ---------------------------------------------
  const cycleIdcToIfr = r.cycleIdcToIfr === undefined ? DEFAULT_CYCLE.idcToIfr : r.cycleIdcToIfr
  const cycleIfrToRetcom = r.cycleIfrToRetcom === undefined ? DEFAULT_CYCLE.ifrToRetcom : r.cycleIfrToRetcom
  const cycleRetcomToIfc = r.cycleRetcomToIfc === undefined ? DEFAULT_CYCLE.retcomToIfc : r.cycleRetcomToIfc
  if (!isPositiveInt(cycleIdcToIfr) || !isPositiveInt(cycleIfrToRetcom) || !isPositiveInt(cycleRetcomToIfc)) {
    return fail('invalid_cycle', 'each cycle length is a whole number of days, greater than zero')
  }

  // --- Step 4: team and roles -------------------------------------------
  const rawRoles = r.roles === undefined ? [] : r.roles
  if (!Array.isArray(rawRoles)) return fail('invalid_input', 'roles must be an array')
  const roles: RoleAssignmentInput[] = []
  const seenPairs = new Set<string>()
  for (const entry of rawRoles) {
    if (typeof entry !== 'object' || entry === null) return fail('invalid_input', 'a role entry is not an object')
    const { userId, role } = entry as Record<string, unknown>
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) return fail('invalid_input', 'a role entry has no valid user id')
    if (!isProjectRole(role)) return fail('invalid_input', `"${String(role)}" is not a DCS project role`)
    // dcs.project_roles is UNIQUE (project_id, user_id, role); a repeated
    // pair in the payload is the caller saying the same thing twice, not a
    // conflict, so it is collapsed rather than rejected.
    const key = `${userId}:${role}`
    if (seenPairs.has(key)) continue
    seenPairs.add(key)
    roles.push({ userId, role })
  }

  // --- Step 5: CTR codes -------------------------------------------------
  const rawCtr = r.ctrCodes === undefined ? [] : r.ctrCodes
  if (!Array.isArray(rawCtr)) return fail('invalid_input', 'ctrCodes must be an array')
  const ctrCodes: CtrCodeInput[] = []
  for (const entry of rawCtr) {
    if (typeof entry !== 'object' || entry === null) return fail('invalid_input', 'a CTR entry is not an object')
    const { code, description } = entry as Record<string, unknown>
    if (typeof code !== 'string' || code.trim() === '') return fail('invalid_input', 'a CTR code is empty')
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return fail('invalid_input', 'a CTR description is not text')
    }
    const trimmedDescription = typeof description === 'string' ? description.trim() : ''
    ctrCodes.push({ code: code.trim(), description: trimmedDescription === '' ? null : trimmedDescription })
  }
  const duplicates = duplicateCtrCodes(ctrCodes.map((entry) => entry.code))
  if (duplicates.length > 0) {
    // Rejected here as well as by sub_projects_project_id_code_key, because
    // the constraint fires only after the project row has been written and
    // rolled back — the user would lose the whole wizard to a typo the app
    // could have caught in the CTR step itself.
    return fail('duplicate_ctr_code', `repeated CTR code(s): ${duplicates.join(', ')}`)
  }

  // --- Step 6: budget ----------------------------------------------------
  const budgetHours = r.budgetHours === undefined || r.budgetHours === null ? null : r.budgetHours
  if (budgetHours !== null && (typeof budgetHours !== 'number' || !Number.isFinite(budgetHours) || budgetHours < 0)) {
    return fail('invalid_budget', 'budget hours must be zero or more')
  }

  return {
    ok: true,
    data: {
      projectCode,
      name: r.name.trim(),
      processType: r.processType,
      year: r.year,
      clientId,
      cpyNumbering,
      cycleIdcToIfr,
      cycleIfrToRetcom,
      cycleRetcomToIfc,
      budgetHours,
      roles,
      ctrCodes,
    },
  }
}

/**
 * `raw` is whatever an untrusted caller sends the update server action —
 * deliberately destructures only the fields UpdateProjectMdrInput declares,
 * so a `projectCode` key present in `raw` is dropped at runtime, not merely
 * unused by the type (same pattern as parseUpdateClientInput).
 */
export function parseUpdateProjectMdrInput(raw: unknown): ActionResult<UpdateProjectMdrInput> {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_input', 'payload is not an object')
  const r = raw as Record<string, unknown>

  if (typeof r.projectId !== 'string' || !UUID_RE.test(r.projectId)) {
    return fail('invalid_input', 'project id is not a uuid')
  }
  const out: UpdateProjectMdrInput = { projectId: r.projectId }

  if (r.name !== undefined) {
    if (typeof r.name !== 'string' || r.name.trim() === '') return fail('invalid_input', 'project name cannot be empty')
    out.name = r.name.trim()
  }
  if (r.clientId !== undefined) {
    if (r.clientId !== null && (typeof r.clientId !== 'string' || !UUID_RE.test(r.clientId))) {
      return fail('invalid_input', 'client id is not a uuid')
    }
    out.clientId = r.clientId as string | null
  }
  if (r.processType !== undefined) {
    if (r.processType !== null && !isProcessType(r.processType)) return fail('invalid_input', 'unknown process type')
    out.processType = r.processType
  }
  if (r.year !== undefined) {
    if (r.year !== null && (typeof r.year !== 'number' || !Number.isInteger(r.year))) {
      return fail('invalid_input', 'year must be a whole number')
    }
    out.year = r.year as number | null
  }
  if (r.cpyNumbering !== undefined) {
    if (typeof r.cpyNumbering !== 'boolean') return fail('invalid_input', 'cpyNumbering must be a boolean')
    out.cpyNumbering = r.cpyNumbering
  }
  for (const key of ['cycleIdcToIfr', 'cycleIfrToRetcom', 'cycleRetcomToIfc'] as const) {
    if (r[key] === undefined) continue
    if (!isPositiveInt(r[key])) return fail('invalid_cycle', 'each cycle length is a whole number of days, greater than zero')
    out[key] = r[key] as number
  }
  if (r.budgetHours !== undefined) {
    if (r.budgetHours !== null && (typeof r.budgetHours !== 'number' || !Number.isFinite(r.budgetHours) || r.budgetHours < 0)) {
      return fail('invalid_budget', 'budget hours must be zero or more')
    }
    out.budgetHours = r.budgetHours as number | null
  }
  if (r.status !== undefined) {
    if (!isMdrStatus(r.status)) return fail('invalid_input', 'unknown MDR status')
    out.status = r.status
  }

  // The internal-project rule again, this time against the fields actually
  // being changed. Only decidable here when the edit sets processType itself;
  // an edit that changes only client_id is checked in updateProjectMdr, which
  // has the stored row to compare against.
  if (out.processType != null && skipsClientStep(out.processType)) {
    if (out.clientId != null || out.cpyNumbering === true) {
      return fail('internal_project_has_client', 'an internal project has no client and no CPY numbering')
    }
  }

  return { ok: true, data: out }
}

/**
 * Translates a PostgREST error into something the wizard can point a user at.
 *
 * Both a clashing project_code and a repeated CTR code arrive as 23505, and
 * both a bad project_code and a bad cycle/budget arrive as 23514 — so this
 * reads the constraint name out of the message rather than mapping the
 * SQLSTATE blindly (supabase/tests/dcs_create_project_mdr.test.sql pins that
 * ambiguity on purpose). An unrecognised constraint falls through to
 * 'db_error' with the raw message attached rather than being guessed at.
 */
export function mapDbError(
  code: string | undefined,
  message: string,
): { ok: false; error: ProjectMdrError; message?: string } {
  switch (code) {
    case '42501':
      return fail('forbidden', message)
    case '22023':
      return fail('internal_project_has_client', message)
    case '23505':
      if (message.includes('sub_projects_project_id_code_key')) return fail('duplicate_ctr_code', message)
      if (message.includes('unique_project_code')) return fail('duplicate_project_code', message)
      return fail('db_error', message)
    case '23514':
      if (message.includes('projects_project_code_format')) return fail('invalid_project_code', message)
      if (message.includes('mdr_settings_cycle')) return fail('invalid_cycle', message)
      if (message.includes('mdr_settings_budget_hours')) return fail('invalid_budget', message)
      return fail('db_error', message)
    case '23503':
      return fail('unknown_user', message)
    case '22P02':
      return fail('invalid_input', message)
    default:
      return fail('db_error', message)
  }
}

/**
 * One RPC, one transaction, four tables. Returns the new project id.
 *
 * Note what is NOT here: no insert into projects followed by an insert into
 * mdr_settings followed by… The rule (CLAUDE.md) is that a multi-table write
 * is one Postgres function, and this module is the reason that rule has teeth
 * — there is no second code path that could drift back into a sequence.
 */
export async function createProjectMdr(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<string>> {
  const auth = await requireAdmin(supabase)
  if (!auth.ok) return auth

  const parsed = parseCreateProjectMdrInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  const { data, error } = await supabase.rpc('dcs_create_project_mdr', {
    p_project_code: input.projectCode,
    p_name: input.name,
    p_process_type: input.processType,
    p_year: input.year,
    p_client_id: input.clientId ?? undefined,
    p_cpy_numbering: input.cpyNumbering,
    p_cycle_idc_to_ifr: input.cycleIdcToIfr,
    p_cycle_ifr_to_retcom: input.cycleIfrToRetcom,
    p_cycle_retcom_to_ifc: input.cycleRetcomToIfc,
    p_budget_hours: input.budgetHours ?? undefined,
    p_roles: input.roles.map((assignment) => ({
      user_id: assignment.userId,
      role: assignment.role,
    })) as unknown as Json,
    p_ctr_codes: input.ctrCodes.map((entry) => ({
      code: entry.code,
      description: entry.description ?? '',
    })) as unknown as Json,
  })

  if (error) return mapDbError(error.code, error.message)
  if (!data) return fail('db_error', 'dcs_create_project_mdr returned no project id')
  return { ok: true, data }
}

/** The project plus its MDR settings, or settings = null when DCS does not run it. */
export async function getProjectMdr(supabase: DbClient, projectId: string): Promise<ProjectMdr | null> {
  const [{ data: project, error: projectError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
    supabase.schema('dcs').from('mdr_settings').select('*').eq('project_id', projectId).maybeSingle(),
  ])
  if (projectError) throw new Error(`getProjectMdr: ${projectError.message}`)
  if (settingsError) throw new Error(`getProjectMdr: ${settingsError.message}`)
  if (!project) return null
  return { project, settings: settings ?? null }
}

/**
 * Diff-only update across the two tables a project's configuration is split
 * between: identity in public.projects, DCS configuration in
 * dcs.mdr_settings (decision O-13). Reads both current rows and writes only
 * the fields that were both provided and actually differ — and issues NO
 * statement at all for a table whose patch came out empty.
 *
 * That last part is not a micro-optimisation. On dcs.mdr_settings an UPDATE
 * that changes nothing still fires set_updated_at() and moves updated_at,
 * which is the only witness this table has (audit_trigger() does not cover it
 * — its PK is project_id, not id, see the 1a.17b note below and in the
 * dialog). supabase/tests/dictionaries_code_immutable.test.sql section 2
 * proves exactly this: audit_log cannot distinguish "no UPDATE sent" from
 * "full row resent unchanged", so the app must send nothing.
 *
 * Changes to public.projects columns ARE audited, by the existing trigger
 * from 1a.08 — one audit_log row per column that actually changed, which is
 * what acceptance criterion 6 reads.
 */
export async function updateProjectMdr(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<ProjectMdr>> {
  const auth = await requireAdmin(supabase)
  if (!auth.ok) return auth

  const parsed = parseUpdateProjectMdrInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  const current = await getProjectMdr(supabase, input.projectId)
  if (!current) return fail('not_found', 'no such project')

  // The internal-project rule, evaluated against the row as it will be after
  // this edit — an edit that adds a client to an already-internal project
  // never mentions processType, so parseUpdateProjectMdrInput cannot see it.
  // `!== undefined`, not `??`: processType null means "clear to not
  // classified" and must be evaluated as such — `null ?? current` would fall
  // back to the OLD type and check the invariant against a value the edit is
  // removing.
  const nextProcessType = input.processType !== undefined ? input.processType : current.project.process_type
  const nextClientId = input.clientId !== undefined ? input.clientId : current.project.client_id
  const nextCpy = input.cpyNumbering !== undefined ? input.cpyNumbering : (current.settings?.cpy_numbering ?? false)
  if (nextProcessType !== null && skipsClientStep(nextProcessType) && (nextClientId != null || nextCpy)) {
    return fail('internal_project_has_client', 'an internal project has no client and no CPY numbering')
  }

  const projectPatch: TablesUpdate<'projects'> = {}
  if (input.name !== undefined && input.name !== current.project.name) projectPatch.name = input.name
  if (input.clientId !== undefined && input.clientId !== current.project.client_id) {
    projectPatch.client_id = input.clientId
  }
  if (input.processType !== undefined && input.processType !== current.project.process_type) {
    projectPatch.process_type = input.processType
  }
  if (input.year !== undefined && input.year !== current.project.year) projectPatch.year = input.year

  const settingsPatch: TablesUpdate<{ schema: 'dcs' }, 'mdr_settings'> = {}
  if (current.settings) {
    const s = current.settings
    if (input.cpyNumbering !== undefined && input.cpyNumbering !== s.cpy_numbering) {
      settingsPatch.cpy_numbering = input.cpyNumbering
    }
    if (input.cycleIdcToIfr !== undefined && input.cycleIdcToIfr !== s.cycle_idc_to_ifr) {
      settingsPatch.cycle_idc_to_ifr = input.cycleIdcToIfr
    }
    if (input.cycleIfrToRetcom !== undefined && input.cycleIfrToRetcom !== s.cycle_ifr_to_retcom) {
      settingsPatch.cycle_ifr_to_retcom = input.cycleIfrToRetcom
    }
    if (input.cycleRetcomToIfc !== undefined && input.cycleRetcomToIfc !== s.cycle_retcom_to_ifc) {
      settingsPatch.cycle_retcom_to_ifc = input.cycleRetcomToIfc
    }
    if (input.budgetHours !== undefined && input.budgetHours !== s.budget_hours) {
      settingsPatch.budget_hours = input.budgetHours
    }
    if (input.status !== undefined && input.status !== s.status) settingsPatch.status = input.status
  } else if (
    input.cpyNumbering !== undefined ||
    input.cycleIdcToIfr !== undefined ||
    input.cycleIfrToRetcom !== undefined ||
    input.cycleRetcomToIfc !== undefined ||
    input.budgetHours !== undefined ||
    input.status !== undefined
  ) {
    // No mdr_settings row means DCS does not run this project. Creating one
    // here would quietly enrol it, which is the wizard's job, not an edit's.
    return fail('not_found', 'this project has no MDR settings — create its MDR first')
  }

  if (Object.keys(projectPatch).length > 0) {
    const { error } = await supabase.from('projects').update(projectPatch).eq('id', input.projectId)
    if (error) return mapDbError(error.code, error.message)
  }
  if (Object.keys(settingsPatch).length > 0) {
    const { error } = await supabase
      .schema('dcs')
      .from('mdr_settings')
      .update(settingsPatch)
      .eq('project_id', input.projectId)
    if (error) return mapDbError(error.code, error.message)
  }

  const refreshed = await getProjectMdr(supabase, input.projectId)
  if (!refreshed) return fail('not_found', 'no such project')
  return { ok: true, data: refreshed }
}
