// DCS 1b.04: creating a document, and the two lists that make the result
// visible (a project's documents, one document's profile).
//
// Same split as lib/project-mdr.ts and lib/dictionaries.ts: takes any typed
// Supabase client and imports nothing from Next.js, so this runs from an RSC,
// a server action or a Vitest test alike. The 'use server' wrappers live in
// app/data/actions/documents.ts.
//
// THE RULE THIS FILE LIVES UNDER (CLAUDE.md): the database is the enforcement,
// this file is the message. Every refusal below is duplicated in Postgres and
// keeps working if this module is bypassed entirely:
//
//   originator = checker      -> CHECK documents_originator_not_checker (1b.04)
//   project has no MDR        -> trigger documents_mdr_required         (1b.04)
//   a hand-written SCL number -> trigger documents_assign_scl_number    (1b.02)
//   a CPY number from non-DC  -> trigger documents_numbering_dc_only    (1b.03)
//   ctr_code of another project -> trigger documents_ctr_code_project   (1b.01)
//   not ORIG/DC on the project -> RLS "Originators insert documents"    (1b.01)
//
// What this file must NEVER do is send scl_doc_number. The column is absent
// from CreateDocumentInput at the type level and dropped again at runtime by
// parseCreateDocumentInput, in the shape lib/project-mdr.ts uses to keep
// project_code out of an update payload.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables, TablesInsert } from '@scl/db'
import type { ProjectRole } from './auth-helpers'
import type { DictionaryRow } from './dictionaries'
import { HISTORY_TABLES } from './document-profile'

export type DocumentRow = Tables<{ schema: 'dcs' }, 'documents'>
type DocumentInsert = TablesInsert<{ schema: 'dcs' }, 'documents'>

type DbClient = SupabaseClient<Database>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a route segment is shaped like a uuid. The profile page checks it
 * before reading: PostgREST answers a non-uuid `id` filter with 22P02, which
 * getDocument would throw as a 500, and "/documents/abc" should be the same 404
 * as "/documents/<a uuid that is not there>".
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * The workflow_status a new document starts in. A dictionary CODE, resolved to
 * an id at write time — never an id baked into the app, because
 * dcs.dictionaries rows are seeded per environment and their uuids differ
 * between local, scl-dev and prod.
 */
export const INITIAL_WORKFLOW_STATUS = 'NOT_STARTED'

/**
 * The language pre-selected in the form.
 *
 * Confirmed decision, and the reason is worth keeping next to the constant:
 * there is NO per-project default language anywhere in the schema. Neither
 * public.projects (id, name, description, is_active, created_at, project_code,
 * client_id, process_type, year) nor dcs.mdr_settings (project_id,
 * cpy_numbering, the three cycles, budget_hours, status, timestamps) carries
 * one. So the form cannot inherit it, and this is a plain default the user
 * changes per document. Adding dcs.mdr_settings.default_language_id later
 * would make this the fallback rather than the answer.
 */
export const DEFAULT_LANGUAGE_CODE = 'EN'

/**
 * The language id the form starts on, before the user has touched anything.
 *
 * Extracted from DocumentCreateForm's useState initialiser rather than left
 * inline, because that is the only way this repo can prove it. vitest here runs
 * in a node environment with no jsdom and no React Testing Library, on purpose
 * (vitest.config.ts, DCS 1a.12): a component's behaviour is asserted by testing
 * the pure function it calls, not by rendering it. The initialiser was the rule;
 * it is now a function, and the component calls it.
 *
 * The two fallbacks are a convenience, not a second default. The caller passes
 * whatever `dict_type = 'language'` returned for this environment, so a
 * dictionary that has lost EN still yields a usable form instead of an empty
 * required field — but whenever EN is present it is the answer, which is what
 * the test pins.
 */
export function defaultLanguageId(languages: readonly Pick<DictionaryRow, 'id' | 'code'>[]): string {
  return languages.find((row) => row.code === DEFAULT_LANGUAGE_CODE)?.id ?? languages[0]?.id ?? ''
}

/** The roles that may create a document, mirroring the two INSERT policies on dcs.documents. */
export const DOCUMENT_AUTHOR_ROLES: readonly ProjectRole[] = ['orig', 'dc']

export type DocumentError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'no_mdr_settings'
  | 'originator_is_checker'
  | 'number_supplied'
  | 'ctr_wrong_project'
  | 'unknown_reference'
  | 'duplicate_number'
  | 'not_found'
  | 'db_error'

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DocumentError; message?: string }

function fail(error: DocumentError, message?: string): { ok: false; error: DocumentError; message?: string } {
  return { ok: false, error, message }
}

/**
 * Note what is absent: scl_doc_number, cpy_doc_number and workflow_status_id.
 *
 * - scl_doc_number is the system's (1b.02) and the form may not have an
 *   opinion about it.
 * - cpy_doc_number belongs to the DC at aal2 and to the 1b.07 profile screen,
 *   not to creation (out of scope for this task).
 * - workflow_status_id is always NOT_STARTED here; a new document has no
 *   revision, so there is nothing else it could be.
 */
export type CreateDocumentInput = {
  projectId: string
  title: string
  docTypeId: string
  disciplineId: string
  areaId: string
  languageId: string
  /** public.sub_projects.id of the same project, or null — SC2601 on scl-dev has no CTR codes at all. */
  ctrCode: string | null
  originatorId: string | null
  checkerId: string | null
  approverId: string | null
  budgetHours: number | null
}

// ---------------------------------------------------------------------------
// Pure helpers. Exported so the form validates in the field the user is
// standing in, with the very code the server action re-runs, and so Vitest
// covers the decisions without a Next.js runtime (vitest.config.ts is
// node-only — the same reason lib/project-mdr.ts keeps its parsing here).
// ---------------------------------------------------------------------------

/**
 * The budget_hours a document type suggests, from its dcs.dictionaries.meta.
 *
 * Returns null rather than throwing for every shape that is not a usable
 * number, because one seeded doc_type genuinely has none: read from scl-dev
 * 2026-09-18, 24 of 25 doc_type rows carry meta.budget_hours and `ZZT`
 * ("1a.21a rehearsal") carries `{}`. ZZT is is_active = false, so
 * getActiveDictionary() never offers it to this form — but "the dropdown
 * cannot show it today" is not a reason for the parser to fall over if it
 * ever does. A DC can flip is_active from /admin/dictionaries without a
 * deploy.
 *
 * Negative values are rejected too: dcs.documents has
 * CHECK (budget_hours >= 0), so pre-filling a negative number would build a
 * form whose default cannot be saved.
 */
export function budgetHoursFromMeta(meta: Json | null | undefined): number | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const value = (meta as Record<string, Json | undefined>).budget_hours
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * D-11, the app half: the Originator may not also be the Checker.
 *
 * Only ever true when both are set — two unstaffed slots are not a collision,
 * which is exactly the NULL escape the CHECK constraint spells out. Keep this
 * in step with documents_originator_not_checker; the constraint is the
 * enforcement and this only decides when to grey out the Save button.
 */
export function originatorIsChecker(input: {
  originatorId: string | null
  checkerId: string | null
}): boolean {
  return input.originatorId !== null && input.originatorId === input.checkerId
}

/**
 * Which projects the New Document form may offer.
 *
 * Deliberately does NOT drop projects that have no dcs.mdr_settings row. The
 * task asks the form to refuse those with a message naming the missing MDR
 * configuration, and a project filtered out of the dropdown can never produce
 * that message — the user would just find their project mysteriously absent.
 * They are returned flagged instead, and the form explains and blocks.
 *
 * aal is not consulted, matching requireAdminOrAnyDc in lib/dictionaries-admin.ts:
 * the second factor is a session-transport property that RLS reads straight
 * from the JWT claim and that this layer cannot independently verify. A DC at
 * aal1 who holds no `orig` role therefore sees the project, and the database
 * refuses the insert — mapped to 'forbidden' by mapDbError, whose message says
 * a verified second factor may be what is missing.
 */
export function creatableProjects<T extends { id: string }>(
  projects: readonly T[],
  rolesByProject: ReadonlyMap<string, readonly ProjectRole[]>,
  projectIdsWithMdr: ReadonlySet<string>,
  isAdmin: boolean,
): (T & { hasMdr: boolean })[] {
  return projects
    .filter((project) => {
      if (isAdmin) return true
      const held = rolesByProject.get(project.id) ?? []
      return held.some((role) => DOCUMENT_AUTHOR_ROLES.includes(role))
    })
    .map((project) => ({ ...project, hasMdr: projectIdsWithMdr.has(project.id) }))
}

/**
 * DCS 1b.04b: which project (if any) New Document preselects from a
 * `?project=` link.
 *
 * `param` is untrusted input — it comes straight off the URL, not from a
 * server read. It is only ever used if it names a project already in
 * `projects`, the server-computed creatable list (creatableProjects above);
 * anything else — missing, malformed, or a real project id the caller may
 * not create documents in — resolves to '', same as no context at all. The
 * form then starts with an empty Project field and the user chooses.
 */
export function resolveProjectFromParam<T extends { id: string }>(
  param: string | undefined,
  projects: readonly T[],
): string {
  if (!param) return ''
  return projects.some((project) => project.id === param) ? param : ''
}

/**
 * Validates whatever an untrusted caller sends the create server action.
 *
 * Returns a typed error rather than a bare 'invalid_input' for the two rules
 * that have their own message in the UI (the MDR gate is not here — it needs a
 * database read, so it lives in createDocument).
 */
export function parseCreateDocumentInput(raw: unknown): ActionResult<CreateDocumentInput> {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_input', 'payload is not an object')
  const r = raw as Record<string, unknown>

  for (const key of ['projectId', 'docTypeId', 'disciplineId', 'areaId', 'languageId'] as const) {
    if (typeof r[key] !== 'string' || !UUID_RE.test(r[key] as string)) {
      return fail('invalid_input', `${key} is required and must be a uuid`)
    }
  }

  if (typeof r.title !== 'string' || r.title.trim() === '') {
    return fail('invalid_input', 'title is required')
  }

  const optionalUuid = (key: 'ctrCode' | 'originatorId' | 'checkerId' | 'approverId') => {
    const value = r[key]
    if (value === undefined || value === null || value === '') return { ok: true as const, value: null }
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      return { ok: false as const, value: null }
    }
    return { ok: true as const, value }
  }

  const ctr = optionalUuid('ctrCode')
  if (!ctr.ok) return fail('invalid_input', 'ctrCode is not a uuid')
  const originator = optionalUuid('originatorId')
  if (!originator.ok) return fail('invalid_input', 'originatorId is not a uuid')
  const checker = optionalUuid('checkerId')
  if (!checker.ok) return fail('invalid_input', 'checkerId is not a uuid')
  const approver = optionalUuid('approverId')
  if (!approver.ok) return fail('invalid_input', 'approverId is not a uuid')

  // D-11, checked here so the user is told which two fields clash rather than
  // reading a constraint name out of a 23514. The CHECK is the enforcement.
  if (originatorIsChecker({ originatorId: originator.value, checkerId: checker.value })) {
    return fail('originator_is_checker', 'the Originator cannot also be the Checker of the same document')
  }

  let budgetHours: number | null = null
  if (r.budgetHours !== undefined && r.budgetHours !== null && r.budgetHours !== '') {
    const value = typeof r.budgetHours === 'string' ? Number(r.budgetHours) : r.budgetHours
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return fail('invalid_input', 'budget hours must be zero or more')
    }
    budgetHours = value
  }

  return {
    ok: true,
    data: {
      projectId: r.projectId as string,
      title: r.title.trim(),
      docTypeId: r.docTypeId as string,
      disciplineId: r.disciplineId as string,
      areaId: r.areaId as string,
      languageId: r.languageId as string,
      ctrCode: ctr.value,
      originatorId: originator.value,
      checkerId: checker.value,
      approverId: approver.value,
      budgetHours,
    },
  }
}

/**
 * Translates a PostgREST error into something the form can point at.
 *
 * Reads the constraint name / message text rather than mapping the SQLSTATE
 * blindly, because 23514 is shared by four different rules on this table:
 * documents_originator_not_checker (1b.04), documents_budget_hours_non_negative
 * (1b.01), enforce_cpy_numbering_enabled and enforce_document_needs_mdr
 * (1b.04) — the last two raise the SAME SQLSTATE and are told apart only by
 * message, which is exactly what supabase/tests/documents_require_mdr_settings
 * .test.sql pins. An unrecognised 23514 falls through to 'db_error' with the
 * raw message attached rather than being guessed at, the same way
 * lib/project-mdr.ts's mapDbError ends.
 */
export function mapDbError(
  code: string | undefined,
  message: string,
): { ok: false; error: DocumentError; message?: string } {
  switch (code) {
    case '42501':
      return fail(
        'forbidden',
        'This project does not allow you to create a document. You need the Originator role on it — or, as its Document Controller, a session with a verified second factor.',
      )
    case '23001': // restrict_violation — documents_assign_scl_number
      return fail('number_supplied', message)
    case '23514':
      if (message.includes('documents_originator_not_checker')) {
        return fail('originator_is_checker', 'the Originator cannot also be the Checker of the same document')
      }
      if (message.includes('no dcs.mdr_settings row')) return fail('no_mdr_settings', message)
      if (message.includes('CPY track')) return fail('invalid_input', message)
      if (message.includes('documents_budget_hours_non_negative')) {
        return fail('invalid_input', 'budget hours must be zero or more')
      }
      return fail('db_error', message)
    case '23503':
      if (message.includes('ctr_code') || message.includes('sub_project')) {
        return fail('ctr_wrong_project', message)
      }
      return fail('unknown_reference', message)
    case '23505':
      return fail('duplicate_number', message)
    case '22P02':
      return fail('invalid_input', message)
    default:
      return fail('db_error', message)
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type DocumentFormOptions = {
  docTypes: DictionaryRow[]
  disciplines: DictionaryRow[]
  areas: DictionaryRow[]
  languages: DictionaryRow[]
}

export type CtrOption = { id: string; code: string; description: string | null }
export type TeamMember = { userId: string; roles: ProjectRole[] }

/**
 * The CTR codes of one project (D-24). public.sub_projects has no `name`
 * column — it is `code` + `description` (read 2026-09-18: SC2699_CTR100 /
 * "Project management"), so both are returned and the picker shows both.
 *
 * is_deleted is filtered but is_active is NOT: an inactive CTR code is one
 * that stopped taking hours in TES, which says nothing about whether
 * documentation may still be booked against it, and guessing otherwise would
 * silently hide codes from the DC.
 */
/**
 * Bulk rather than per-project, and the reason is a convention rather than a
 * micro-optimisation: docs/03-conventions.md forbids client-side fetching, so
 * changing the project in the New Document form may not trigger a round trip.
 * The RSC therefore loads the CTR codes of every project the user could pick,
 * once, and the form narrows them in the browser.
 */
export async function getCtrCodesByProject(
  supabase: DbClient,
  projectIds: readonly string[],
): Promise<Map<string, CtrOption[]>> {
  const byProject = new Map<string, CtrOption[]>()
  if (projectIds.length === 0) return byProject

  const { data, error } = await supabase
    .from('sub_projects')
    .select('id, code, description, project_id')
    .in('project_id', projectIds)
    .eq('is_deleted', false)
    .order('code')
  if (error) throw new Error(`getCtrCodesByProject: ${error.message}`)

  for (const row of data ?? []) {
    const list = byProject.get(row.project_id) ?? []
    list.push({ id: row.id, code: row.code, description: row.description })
    byProject.set(row.project_id, list)
  }
  return byProject
}

/** Everyone holding any dcs.project_roles row on these projects — the staffing candidates. */
export async function getTeamsByProject(
  supabase: DbClient,
  projectIds: readonly string[],
): Promise<Map<string, TeamMember[]>> {
  const byProject = new Map<string, TeamMember[]>()
  if (projectIds.length === 0) return byProject

  const { data, error } = await supabase
    .schema('dcs')
    .from('project_roles')
    .select('project_id, user_id, role')
    .in('project_id', projectIds)
  if (error) throw new Error(`getTeamsByProject: ${error.message}`)

  const rolesByProjectUser = new Map<string, Map<string, ProjectRole[]>>()
  for (const row of data ?? []) {
    const users = rolesByProjectUser.get(row.project_id) ?? new Map<string, ProjectRole[]>()
    const roles = users.get(row.user_id) ?? []
    roles.push(row.role)
    users.set(row.user_id, roles)
    rolesByProjectUser.set(row.project_id, users)
  }
  for (const [projectId, users] of rolesByProjectUser) {
    byProject.set(
      projectId,
      [...users].map(([userId, roles]) => ({ userId, roles })),
    )
  }
  return byProject
}

/** Project ids that have a dcs.mdr_settings row — i.e. the projects DCS runs. */
export async function getProjectIdsWithMdr(supabase: DbClient): Promise<Set<string>> {
  const { data, error } = await supabase.schema('dcs').from('mdr_settings').select('project_id')
  if (error) throw new Error(`getProjectIdsWithMdr: ${error.message}`)
  return new Set((data ?? []).map((row) => row.project_id))
}

/**
 * The documents of one project, newest first.
 *
 * NOTE for the RLS reading (docs/03-conventions.md): this query carries an
 * .eq() and therefore proves NOTHING about policies on its own — it is a
 * project-scoped list, and the scope is the point. The RLS proof for
 * dcs.documents is the bare, filter-free count in
 * supabase/tests/rls_document_register.test.sql section 5.
 */
export async function listProjectDocuments(supabase: DbClient, projectId: string) {
  const { data, error } = await supabase
    .schema('dcs')
    .from('documents')
    // Three things about this string, each of which cost a compile error:
    //
    // 1. Every dictionary embed names its FOREIGN KEY CONSTRAINT, not its
    //    column. dcs.documents has FIVE separate foreign keys into
    //    dcs.dictionaries, so a bare `dictionaries(...)` embed is ambiguous,
    //    and each is COMPOSITE — (doc_type_id, doc_type_dict_type) -> (id,
    //    dict_type) — which a column-named embed cannot express at all.
    // 2. It must be ONE STRING LITERAL. supabase-js parses the select at the
    //    type level, so a string built with `+` degrades to `string` and every
    //    column comes back as GenericStringError. Do not "tidy" this into
    //    concatenated lines.
    // 3. ctr_code is NOT embedded. Its foreign key crosses schemas (dcs ->
    //    public.sub_projects), and cross-schema relationships are absent from
    //    the generated Relationships, so the id is selected raw and resolved by
    //    the caller. Same for originator/checker/approver -> public.profiles,
    //    which go through dcs_profile_directory() anyway (1a.14b).
    .select(
      `id, scl_doc_number, title, budget_hours, created_at,
       doc_type:dictionaries!documents_doc_type_id_fkey(code, label),
       discipline:dictionaries!documents_discipline_id_fkey(code, label),
       area:dictionaries!documents_area_id_fkey(code, label),
       language:dictionaries!documents_language_id_fkey(code, label),
       workflow_status:dictionaries!documents_workflow_status_id_fkey(code, label)`,
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listProjectDocuments: ${error.message}`)
  return data ?? []
}

/** One document with every dictionary label resolved, for the profile page. */
export async function getDocument(supabase: DbClient, documentId: string) {
  const { data, error } = await supabase
    .schema('dcs')
    .from('documents')
    // Constraint-named embeds in ONE string literal, and no cross-schema
    // embed — all three reasons are spelled out on listProjectDocuments above.
    .select(
      `id, project_id, scl_doc_number, cpy_doc_number, title, budget_hours,
       originator_id, checker_id, approver_id, ctr_code, current_revision_id, created_at, updated_at,
       doc_type:dictionaries!documents_doc_type_id_fkey(code, label),
       discipline:dictionaries!documents_discipline_id_fkey(code, label),
       area:dictionaries!documents_area_id_fkey(code, label),
       language:dictionaries!documents_language_id_fkey(code, label),
       workflow_status:dictionaries!documents_workflow_status_id_fkey(code, label)`,
    )
    .eq('id', documentId)
    .maybeSingle()
  if (error) throw new Error(`getDocument: ${error.message}`)
  return data
}

// ---------------------------------------------------------------------------
// Profile reads (DCS 1b.07)
//
// Every read below is a plain session-client read and adds no filter that
// widens anything: what a reader sees is what RLS returns. None of them
// proves anything about a policy on its own (each carries an .eq()/.in(), see
// the RLS note on listProjectDocuments) — the proofs are the pgTAP files and
// the three browser sessions in the PR.
// ---------------------------------------------------------------------------

/**
 * Whether this project runs a CPY numbering track (dcs.mdr_settings
 * .cpy_numbering). A project with no mdr_settings row reads as false, which is
 * exactly how the database treats it (enforce_cpy_numbering_enabled coalesces
 * an absent row to false). "Authenticated users can read mdr settings" makes
 * this readable for every signed-in user.
 */
export async function getProjectCpyNumbering(supabase: DbClient, projectId: string): Promise<boolean> {
  const { data, error } = await supabase
    .schema('dcs')
    .from('mdr_settings')
    .select('cpy_numbering')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new Error(`getProjectCpyNumbering: ${error.message}`)
  return data?.cpy_numbering ?? false
}

/**
 * One revision with its step and status labels, and its files.
 *
 * The files are a second query rather than an embed: files -> revisions is a
 * composite foreign key ((revision_id, project_id) -> (id, project_id)), and
 * the constraint-named embed used for the dictionaries above is one more thing
 * to get wrong for no gain. Two indexed reads cost the same as one join here.
 *
 * Returns null when the revision cannot be read — a current_revision_id that
 * points at a row RLS hides — so the panel renders its empty state instead of
 * failing the page. Files are read-only metadata: no storage_path is turned
 * into a link here, that is 1b.09.
 */
export async function getRevisionWithFiles(supabase: DbClient, revisionId: string) {
  const [revision, files] = await Promise.all([
    supabase
      .schema('dcs')
      .from('revisions')
      .select(
        `id, document_id, scl_revision, cpy_revision, reason_for_issue, revision_date, created_at,
         step:dictionaries!revisions_step_id_fkey(code, label),
         status:dictionaries!revisions_status_id_fkey(code, label)`,
      )
      .eq('id', revisionId)
      .maybeSingle(),
    supabase
      .schema('dcs')
      .from('files')
      .select('id, file_kind, file_name, original_name, storage_path, size_bytes, uploaded_at, uploaded_by')
      .eq('revision_id', revisionId)
      .order('sort_order', { ascending: true })
      .order('uploaded_at', { ascending: true }),
  ])
  if (revision.error) throw new Error(`getRevisionWithFiles: ${revision.error.message}`)
  if (files.error) throw new Error(`getRevisionWithFiles: ${files.error.message}`)
  if (!revision.data) return null
  return { revision: revision.data, files: files.data ?? [] }
}

/** Every revision id of one document — the History tab reads their audit rows too. */
export async function listRevisionIds(supabase: DbClient, documentId: string): Promise<string[]> {
  const { data, error } = await supabase.schema('dcs').from('revisions').select('id').eq('document_id', documentId)
  if (error) throw new Error(`listRevisionIds: ${error.message}`)
  return (data ?? []).map((row) => row.id)
}

/** How many audit rows the History tab reads at most; the tab says so when it hits the cap. */
export const HISTORY_LIMIT = 200

/**
 * The audit trail of one document, newest first.
 *
 * The table_name filter is not a security measure: it lets Postgres use
 * audit_log_table_name_record_id_occurred_at_idx, whose leading column is
 * table_name. What the reader may see is decided by the two SELECT policies on
 * public.audit_log ("Admins read audit log", "Doc controllers read own project
 * audit log") — for anyone else this returns an empty array, NOT an error,
 * which is why the tab's empty state has to name that possibility.
 */
export async function getDocumentHistory(supabase: DbClient, recordIds: readonly string[]) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, occurred_at, user_id, table_name, record_id, action, field_name, old_value, new_value')
    .in('table_name', [...HISTORY_TABLES])
    .in('record_id', [...recordIds])
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (error) throw new Error(`getDocumentHistory: ${error.message}`)
  return data ?? []
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Creates one document and returns its id.
 *
 * The insert deliberately names every column it sets, so scl_doc_number cannot
 * be smuggled in by an extra key on the input object: the payload is built
 * field by field from the parsed value, never spread from `raw`.
 *
 * workflow_status_id is resolved from the CODE 'NOT_STARTED' on every call
 * rather than cached: dictionary uuids differ per environment, and one extra
 * indexed read is cheaper than a class of bug where a stale id points at
 * another environment's row.
 */
export async function createDocument(supabase: DbClient, rawInput: unknown): Promise<ActionResult<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  const parsed = parseCreateDocumentInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  // The MDR gate, checked here so the user gets the sentence the task asked
  // for instead of a raw 23514 out of the trigger. The trigger is the rule;
  // this is only the wording, and it stays correct if the read below races —
  // a project enrolled between this check and the insert simply succeeds.
  const { data: mdr, error: mdrError } = await supabase
    .schema('dcs')
    .from('mdr_settings')
    .select('project_id')
    .eq('project_id', input.projectId)
    .maybeSingle()
  if (mdrError) return mapDbError(mdrError.code, mdrError.message)
  if (!mdr) {
    return fail(
      'no_mdr_settings',
      'DCS does not run this project yet: it has no MDR configuration. Its Document Controller must create the project MDR before any document can be added.',
    )
  }

  const { data: status, error: statusError } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .select('id')
    .eq('dict_type', 'workflow_status')
    .eq('code', INITIAL_WORKFLOW_STATUS)
    .maybeSingle()
  if (statusError) return mapDbError(statusError.code, statusError.message)
  if (!status) {
    return fail('db_error', `no workflow_status dictionary row with code ${INITIAL_WORKFLOW_STATUS}`)
  }

  // scl_doc_number is NOT here, and must never be: the BEFORE INSERT trigger
  // documents_assign_scl_number (1b.02) fills it, and raises restrict_violation
  // for any caller that supplies one.
  //
  // Typed as the generated Insert row MINUS that column, which is the one
  // thing the generated types cannot express: dcs.documents.scl_doc_number is
  // NOT NULL with no column DEFAULT, so `supabase gen types` marks it
  // required, while in reality a BEFORE trigger supplies it and NOT NULL is
  // checked afterwards. Every other column stays fully checked — this is not
  // `as any` (CLAUDE.md forbids that on queries, and rightly: it would also
  // have hidden the five ambiguous dictionary embeds above). Deliberately
  // written as one narrow Omit at one line rather than a loosened payload
  // type, so a typo in any other column name still fails the build.
  const payload: Omit<DocumentInsert, 'scl_doc_number'> = {
    project_id: input.projectId,
    title: input.title,
    doc_type_id: input.docTypeId,
    discipline_id: input.disciplineId,
    area_id: input.areaId,
    language_id: input.languageId,
    workflow_status_id: status.id,
    ctr_code: input.ctrCode,
    originator_id: input.originatorId,
    checker_id: input.checkerId,
    approver_id: input.approverId,
    budget_hours: input.budgetHours,
  }

  const { data, error } = await supabase
    .schema('dcs')
    .from('documents')
    .insert(payload as DocumentInsert)
    .select('id')
    .single()

  if (error) return mapDbError(error.code, error.message)
  return { ok: true, data: data.id }
}

// ---------------------------------------------------------------------------
// Set the CPY number (DCS 1b.07)
//
// 1b.03 guarded this column in the database and named this action as not done
// ("the setCpyNumber() server action ... 1b.07", migration
// 20260918092728). It is written here, and it is deliberately thin: it parses
// the payload, updates ONE column, and translates what Postgres said. Whether
// the caller may is decided entirely by the database:
//
//   the project has no CPY track  -> trigger documents_cpy_numbering      (1b.01)
//   the caller is not its DC      -> trigger documents_numbering_dc_only  (1b.03)
//   the session is not aal2       -> the same trigger, and RLS "Doc controllers update documents"
//   another document has the number -> UNIQUE (project_id, cpy_doc_number) (1b.01)
//
// No requireProjectRole here, on purpose: a guard in front would be a second
// copy of the trigger that can drift from it, and the trigger already says why
// in a sentence. The only thing this function adds is that sentence, phrased
// for the person at the field.
// ---------------------------------------------------------------------------

export type SetCpyNumberInput = {
  documentId: string
  /** null clears the number; the empty string is the same thing. */
  cpyNumber: string | null
}

/**
 * Validates whatever an untrusted caller sends the server action.
 *
 * The CPY number has no format rule anywhere in the schema or the docs — it is
 * the client's own numbering (docs/00-glossary.md: "Tor CPY to numeracja
 * prowadzona przez klienta") and the column is plain text — so the only
 * things checked are that it is a string and that surrounding whitespace is
 * not stored. Inventing a pattern here would reject numbers a client actually
 * uses.
 */
export function parseSetCpyNumberInput(raw: unknown): ActionResult<SetCpyNumberInput> {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_input', 'payload is not an object')
  const r = raw as Record<string, unknown>
  if (typeof r.documentId !== 'string' || !UUID_RE.test(r.documentId)) {
    return fail('invalid_input', 'documentId is required and must be a uuid')
  }
  if (r.cpyNumber !== null && r.cpyNumber !== undefined && typeof r.cpyNumber !== 'string') {
    return fail('invalid_input', 'cpyNumber must be a string or null')
  }
  const trimmed = typeof r.cpyNumber === 'string' ? r.cpyNumber.trim() : ''
  return { ok: true, data: { documentId: r.documentId, cpyNumber: trimmed === '' ? null : trimmed } }
}

/**
 * The CPY-specific translation of a PostgREST error.
 *
 * Not mapDbError: that one words 42501 as "you cannot CREATE a document", which
 * is the wrong sentence at this field. The two 42501 texts the DC trigger can
 * raise are told apart by message — "verified second factor" for aal1, the
 * other for a non-DC — because the fix differs.
 */
export function mapCpyDbError(
  code: string | undefined,
  message: string,
): { ok: false; error: DocumentError; message?: string } {
  switch (code) {
    case '42501':
      if (message.includes('verified second factor')) {
        return fail(
          'forbidden',
          'Setting the CPY number needs a session with a verified second factor. Sign in again and complete the second-factor challenge.',
        )
      }
      return fail('forbidden', 'Only the Document Controller of this project can set the CPY number.')
    case '23514':
      if (message.includes('CPY track')) {
        return fail('invalid_input', 'This project does not run a client (CPY) numbering track, so a CPY number cannot be set.')
      }
      return fail('db_error', message)
    case '23505':
      return fail('duplicate_number', 'Another document in this project already has this CPY number.')
    default:
      return fail('db_error', message)
  }
}

/**
 * Sets (or clears) one document's CPY number and returns what was stored.
 *
 * An UPDATE that RLS filters away is NOT an error in PostgREST — it succeeds
 * with zero rows. That happens for a plain member (no update policy) and for a
 * DC at aal1 (the policy's aal2 conjunct), so a missing row after the update
 * is reported as 'forbidden' rather than swallowed. It also covers a document
 * id that does not exist, which is indistinguishable by design (the same
 * "does not reveal whether an id exists" rule the profile page follows).
 */
export async function setCpyNumber(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<{ documentId: string; cpyNumber: string | null }>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  const parsed = parseSetCpyNumberInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  const { data, error } = await supabase
    .schema('dcs')
    .from('documents')
    .update({ cpy_doc_number: input.cpyNumber })
    .eq('id', input.documentId)
    .select('id, cpy_doc_number')
    .maybeSingle()

  if (error) return mapCpyDbError(error.code, error.message)
  if (!data) {
    return fail(
      'forbidden',
      'The CPY number was not changed: this document is not visible to you, or your session may not change it. Only the Document Controller of the project can, with a verified second factor.',
    )
  }
  return { ok: true, data: { documentId: data.id, cpyNumber: data.cpy_doc_number } }
}
