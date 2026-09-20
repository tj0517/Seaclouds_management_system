// DCS 1b.08: creating a revision, proposing its code, and reading a document's
// revision history for the Revisions tab.
//
// Same split as lib/documents.ts: takes any typed Supabase client and imports
// nothing from Next.js, so it runs from an RSC, a server action or a Vitest
// test alike. The 'use server' wrappers live in app/data/actions/revisions.ts.
//
// THE RULE THIS FILE LIVES UNDER (CLAUDE.md): the database is the enforcement,
// this file is the message. Every refusal below is duplicated in Postgres and
// keeps working if this module is bypassed entirely:
//
//   a hand-typed SCL code        -> trigger revisions_assign_scl_revision   (1b.08)
//   a code of the wrong shape    -> the same trigger, 23514                  (1b.08)
//   a RETCOM revision            -> the same trigger, 23514                  (1b.08)
//   a revision on a Void document-> trigger revisions_refuse_void_document  (1b.08)
//   a CPY revision, wrong caller -> trigger revisions_numbering_dc_only_insert (1b.03)
//   a CPY revision, no CPY track -> trigger revisions_cpy_numbering          (1b.01)
//   not ORIG / DC-at-aal2 / admin-> RLS "... insert revisions"               (1b.01)
//
// What this file must NEVER do is invent the SCL revision. The code is the
// database's: the insert leaves `scl_revision` out, and the only time it is sent
// is when the project's Document Controller, in an aal2 session, typed a value
// over the proposal — and even then the trigger re-checks who they are and what
// shape it has. The current revision, the NOT_STARTED -> STARTED move and the
// SUPERSEDED marking of the previous revision are the database's too
// (trigger revisions_promote_current): nothing here writes them.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert } from '@scl/db'
import { dictionaryLabel, personName, toFileRows, type CpyFieldMode, type FileRowView } from './document-profile'

type DbClient = SupabaseClient<Database>
type RevisionInsert = TablesInsert<{ schema: 'dcs' }, 'revisions'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Steps: what the dialog offers
// ---------------------------------------------------------------------------

/**
 * The workflow steps that have an SCL revision series, in lifecycle order.
 *
 * Mirrors dcs.revision_series_pattern(): IDC, IFR and IFC/IFI/IFB have a
 * series; RETCOM has none, on purpose (docs/adr/0015 — the client returns a
 * document, SCL issues nothing), and a step a DC adds to the dictionary has none
 * until someone defines one. The database is the authority — it raises for both
 * — this list only keeps the dialog from offering a choice that cannot be saved.
 */
export const REVISION_STEP_CODES = ['IDC', 'IFR', 'IFC', 'IFI', 'IFB'] as const

/** The dictionary rows the dialog may offer as a step: the ones with a series, in the order the dictionary gives them. */
export function revisionStepOptions<T extends { code: string }>(steps: readonly T[]): T[] {
  return steps.filter((step) => (REVISION_STEP_CODES as readonly string[]).includes(step.code))
}

/**
 * The step the dialog starts on: the current revision's own step, so pressing
 * Create issues the next code of the same series ("the last revision of the same
 * step plus one"); IDC — the first step — when the document has no revision yet.
 * A suggestion only: the user picks the step, and no state machine decides it.
 */
export function defaultRevisionStepId<T extends { id: string; code: string }>(
  options: readonly T[],
  currentStepCode: string | null | undefined,
): string {
  return options.find((option) => option.code === currentStepCode)?.id ?? options[0]?.id ?? ''
}

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

export type NewRevisionAccess =
  | { mode: 'enabled' }
  | { mode: 'disabled'; reason: 'void' | 'needs_second_factor' | 'not_allowed'; hint: string }

/**
 * Whether the New Revision button is live for this reader.
 *
 * MIRRORS, does not enforce. The real guards are the two INSERT policies on
 * dcs.revisions — "Originators insert revisions" (an `orig` role on the project,
 * no second factor) and "Doc controllers insert revisions" (`dc` AND aal2) — the
 * admin policy, and trigger revisions_refuse_void_document. A wrong answer here
 * can only produce a button that is offered and then refused, or one that is
 * withheld from someone the database would have let write.
 *
 * Void is checked first: whatever the reader's role, "this document takes no
 * revisions" is the true reason and the one worth saying.
 */
export function newRevisionAccess(input: {
  isAdmin: boolean
  isOrig: boolean
  isDc: boolean
  aal2: boolean
  documentStatusCode: string | null | undefined
}): NewRevisionAccess {
  if (input.documentStatusCode === 'VOID') {
    return {
      mode: 'disabled',
      reason: 'void',
      hint: 'This document is Void and takes no new revisions. To continue the work, create a new document.',
    }
  }
  if (input.isAdmin || input.isOrig || (input.isDc && input.aal2)) return { mode: 'enabled' }
  if (input.isDc) {
    return {
      mode: 'disabled',
      reason: 'needs_second_factor',
      hint: 'Creating a revision as Document Controller needs a session with a verified second factor.',
    }
  }
  return {
    mode: 'disabled',
    reason: 'not_allowed',
    hint: 'Only an Originator or the Document Controller of this project can create a revision.',
  }
}

export type SclCodeField = { mode: 'editable' } | { mode: 'assigned'; hint: string }

/**
 * Whether the SCL revision field is editable — the project's Document Controller
 * in an aal2 session, exactly the caller assign_scl_revision accepts a supplied
 * code from. Everyone else sees the proposal as read-only text: it is what the
 * database will assign.
 */
export function sclCodeField(input: { isProjectDc: boolean; aal2: boolean }): SclCodeField {
  if (input.isProjectDc && input.aal2) return { mode: 'editable' }
  if (input.isProjectDc) {
    return {
      mode: 'assigned',
      hint: 'Assigned by the system. As Document Controller you can choose the code in a session with a verified second factor.',
    }
  }
  return { mode: 'assigned', hint: 'Assigned by the system when you save.' }
}

export type CpyRevisionField = { mode: 'editable' } | { mode: 'hidden'; hint: string | null }

/**
 * Whether the dialog shows the client (CPY) revision field.
 *
 * DC only, on a project that runs a CPY track, in an aal2 session — owner's
 * decision 6 for 1b.08, matching trigger revisions_numbering_dc_only_insert
 * (1b.03), which makes cpy_revision a DC-only value on INSERT. An Originator who
 * typed one would be refused (42501), so the field is not offered to them; a
 * sentence says who sets it, but only where the project runs a CPY track at all.
 * Reuses cpyFieldMode() from the document profile, which encodes the same three
 * rules for the CPY document number — one decision, not two copies.
 */
export function cpyRevisionField(mode: CpyFieldMode): CpyRevisionField {
  if (mode.mode === 'editable') return { mode: 'editable' }
  if (mode.mode === 'numbering_off') return { mode: 'hidden', hint: null }
  return { mode: 'hidden', hint: 'The client (CPY) revision is set by the project’s Document Controller.' }
}

// ---------------------------------------------------------------------------
// Errors and input
// ---------------------------------------------------------------------------

export type RevisionError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'not_found'
  | 'void_document'
  | 'no_series'
  | 'code_not_allowed'
  | 'code_shape'
  | 'duplicate_code'
  | 'series_exhausted'
  | 'cpy_off'
  | 'db_error'

export type RevisionResult<T> = { ok: true; data: T } | { ok: false; error: RevisionError; message?: string }

function fail(error: RevisionError, message?: string): { ok: false; error: RevisionError; message?: string } {
  return { ok: false, error, message }
}

/** A real calendar date in YYYY-MM-DD form — what <input type="date"> produces and dcs.revisions.revision_date stores. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Today's date in the reader's own calendar, as the date input's initial value. */
export function todayLocalIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export type CreateRevisionInput = {
  documentId: string
  stepId: string
  /** Set ONLY when the Document Controller typed over the proposal. null = let the database assign it. */
  sclRevision: string | null
  cpyRevision: string | null
  revisionDate: string
  reasonForIssue: string | null
  acceptanceCodeId: string | null
}

/**
 * Validates whatever an untrusted caller sends the create server action.
 *
 * The payload is built field by field, never spread from `raw`: an extra key
 * (status_id, created_by, current_revision_id …) is dropped here, which is what
 * keeps the client from choosing them. `revisionDate` is required — a blank
 * issue date would show as an empty cell in dcs.v_mdr, which is worse than a
 * required field (owner's decision, 1b.08).
 */
export function parseCreateRevisionInput(raw: unknown): RevisionResult<CreateRevisionInput> {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_input', 'payload is not an object')
  const r = raw as Record<string, unknown>

  for (const key of ['documentId', 'stepId'] as const) {
    if (typeof r[key] !== 'string' || !UUID_RE.test(r[key] as string)) {
      return fail('invalid_input', `${key} is required and must be a uuid`)
    }
  }
  if (typeof r.revisionDate !== 'string' || !isValidDateString(r.revisionDate)) {
    return fail('invalid_input', 'Revision date is required (YYYY-MM-DD).')
  }

  const optionalText = (key: 'sclRevision' | 'cpyRevision' | 'reasonForIssue'): string | null | undefined => {
    const value = r[key]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  const scl = optionalText('sclRevision')
  if (scl === undefined) return fail('invalid_input', 'sclRevision must be a string')
  const cpy = optionalText('cpyRevision')
  if (cpy === undefined) return fail('invalid_input', 'cpyRevision must be a string')
  const reason = optionalText('reasonForIssue')
  if (reason === undefined) return fail('invalid_input', 'reasonForIssue must be a string')

  let acceptanceCodeId: string | null = null
  if (r.acceptanceCodeId !== undefined && r.acceptanceCodeId !== null && r.acceptanceCodeId !== '') {
    if (typeof r.acceptanceCodeId !== 'string' || !UUID_RE.test(r.acceptanceCodeId)) {
      return fail('invalid_input', 'acceptanceCodeId is not a uuid')
    }
    acceptanceCodeId = r.acceptanceCodeId
  }

  return {
    ok: true,
    data: {
      documentId: r.documentId as string,
      stepId: r.stepId as string,
      sclRevision: scl,
      cpyRevision: cpy,
      revisionDate: r.revisionDate,
      reasonForIssue: reason,
      acceptanceCodeId,
    },
  }
}

/**
 * Translates a PostgREST error from the insert into something the dialog can
 * show. Reads the SQLSTATE AND the message: 42501 and 23514 are each raised by
 * several rules on dcs.revisions, told apart only by the text the triggers
 * write — pinned by supabase/tests/scl_revision_generator.test.sql. An
 * unrecognised error falls through to 'db_error' with the raw message attached
 * rather than being guessed at.
 */
export function mapRevisionDbError(code: string | undefined, message: string): { ok: false; error: RevisionError; message?: string } {
  switch (code) {
    case '42501':
      if (message.includes('scl_revision may be supplied') && message.includes('second factor')) {
        return fail(
          'forbidden',
          'Choosing the revision code needs a session with a verified second factor. Sign in again and complete the second-factor challenge.',
        )
      }
      if (message.includes('scl_revision is assigned by the system')) {
        return fail('code_not_allowed', 'Only the Document Controller of this project can choose the revision code. Leave it as proposed.')
      }
      if (message.includes('cpy_revision') && message.includes('second factor')) {
        return fail(
          'forbidden',
          'Setting the client (CPY) revision needs a session with a verified second factor. Sign in again and complete the second-factor challenge.',
        )
      }
      if (message.includes('cpy_revision')) {
        return fail('forbidden', 'Only the Document Controller of this project can set the client (CPY) revision.')
      }
      return fail(
        'forbidden',
        'You cannot create a revision on this document. You need the Originator role on the project — or, as its Document Controller, a session with a verified second factor.',
      )
    case '23514':
      if (message.includes('is Void')) {
        return fail('void_document', 'This document is Void and takes no new revisions. To continue the work, create a new document.')
      }
      if (message.includes('RETCOM')) {
        return fail(
          'no_series',
          'RETCOM has no SCL revision series: it is the client returning a document, not SCL issuing a revision. Choose the step you are issuing.',
        )
      }
      if (message.includes('is not a valid code for step')) return fail('code_shape', message)
      if (message.includes('CPY track')) {
        return fail('cpy_off', 'This project does not run a client (CPY) numbering track, so a CPY revision cannot be set.')
      }
      return fail('db_error', message)
    case '23505':
      return fail(
        'duplicate_code',
        'A revision with this code already exists on the document — most likely someone just created one. Reopen the dialog for the next code.',
      )
    case '22003':
      return fail('series_exhausted', message)
    case '22023':
      if (message.includes('RETCOM') || message.includes('has no SCL revision series')) {
        return fail('no_series', 'This step has no SCL revision series, so no revision can be created on it.')
      }
      if (message.includes('no dcs.documents row')) return fail('not_found', 'This document is not visible to you, or does not exist.')
      return fail('invalid_input', message)
    case '23503':
      return fail('invalid_input', message)
    default:
      return fail('db_error', message)
  }
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

/**
 * The next SCL revision code for this document and step, as the database would
 * assign it right now (dcs.next_revision_code). A proposal, not a reservation:
 * the number that is stored is computed again by the trigger, inside the insert,
 * so two originators pressing Create together can see the same proposal and get
 * A and B.
 */
export async function proposeRevisionCode(
  supabase: DbClient,
  rawInput: unknown,
): Promise<RevisionResult<{ code: string }>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  if (typeof rawInput !== 'object' || rawInput === null) return fail('invalid_input', 'payload is not an object')
  const r = rawInput as Record<string, unknown>
  if (typeof r.documentId !== 'string' || !UUID_RE.test(r.documentId)) {
    return fail('invalid_input', 'documentId is required and must be a uuid')
  }
  if (typeof r.stepId !== 'string' || !UUID_RE.test(r.stepId)) {
    return fail('invalid_input', 'stepId is required and must be a uuid')
  }

  const { data, error } = await supabase
    .schema('dcs')
    .rpc('next_revision_code', { p_document_id: r.documentId, p_step_id: r.stepId })
  if (error) return mapRevisionDbError(error.code, error.message)
  if (typeof data !== 'string') return fail('db_error', 'next_revision_code returned no code')
  return { ok: true, data: { code: data } }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Creates one revision and returns its id and the code the database gave it.
 *
 * The insert names every column it sets. `scl_revision` is left out unless the
 * Document Controller typed one; `status_id` is the workflow_status whose CODE
 * equals the step's code (an IFR revision is inserted as IFR — owner's decision,
 * 1b.08), resolved on every call because dictionary uuids differ per
 * environment. `created_by` is the signed-in user, taken from the session and
 * not from the payload. Nothing here sets current_revision_id, the document's
 * status or the previous revision's status: revisions_promote_current does, in
 * the same transaction.
 *
 * created_by is NOT enforced by the database (no trigger sets it), so a caller
 * writing to PostgREST directly could put another user's id there; the audit
 * log, which reads auth.uid(), is the record that cannot be forged.
 */
export async function createRevision(
  supabase: DbClient,
  rawInput: unknown,
): Promise<RevisionResult<{ id: string; sclRevision: string }>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  const parsed = parseCreateRevisionInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  // The document, for its project: dcs.revisions carries project_id, held to the
  // document's by a composite foreign key. RLS decides whether it is visible.
  const { data: document, error: documentError } = await supabase
    .schema('dcs')
    .from('documents')
    .select('id, project_id')
    .eq('id', input.documentId)
    .maybeSingle()
  if (documentError) return mapRevisionDbError(documentError.code, documentError.message)
  if (!document) return fail('not_found', 'This document is not visible to you, or does not exist.')

  const { data: step, error: stepError } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .select('code')
    .eq('id', input.stepId)
    .eq('dict_type', 'workflow_step')
    .maybeSingle()
  if (stepError) return mapRevisionDbError(stepError.code, stepError.message)
  if (!step) return fail('invalid_input', 'stepId is not a workflow step')

  const { data: status, error: statusError } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .select('id')
    .eq('dict_type', 'workflow_status')
    .eq('code', step.code)
    .maybeSingle()
  if (statusError) return mapRevisionDbError(statusError.code, statusError.message)
  if (!status) return fail('db_error', `no workflow_status dictionary row with code ${step.code}`)

  // scl_revision is typed as required by the generated types because the column
  // is NOT NULL with no DEFAULT, while a BEFORE trigger fills it: the same
  // situation as documents.scl_doc_number, handled the same way (one narrow
  // Omit, not `as any`) — see createDocument in lib/documents.ts.
  const payload: Omit<RevisionInsert, 'scl_revision'> & { scl_revision?: string } = {
    document_id: document.id,
    project_id: document.project_id,
    step_id: input.stepId,
    status_id: status.id,
    revision_date: input.revisionDate,
    reason_for_issue: input.reasonForIssue,
    acceptance_code_id: input.acceptanceCodeId,
    cpy_revision: input.cpyRevision,
    created_by: user.id,
  }
  if (input.sclRevision !== null) payload.scl_revision = input.sclRevision

  const { data, error } = await supabase
    .schema('dcs')
    .from('revisions')
    .insert(payload as RevisionInsert)
    .select('id, scl_revision')
    .single()
  if (error) return mapRevisionDbError(error.code, error.message)
  return { ok: true, data: { id: data.id, sclRevision: data.scl_revision } }
}

// ---------------------------------------------------------------------------
// Read: the Revisions tab
// ---------------------------------------------------------------------------

type RevisionRecord = NonNullable<Awaited<ReturnType<typeof readRevisions>>>[number]

async function readRevisions(supabase: DbClient, documentId: string) {
  const { data, error } = await supabase
    .schema('dcs')
    .from('revisions')
    // One string literal, constraint-named embeds — the three reasons are spelled
    // out on listProjectDocuments in lib/documents.ts. created_by points at
    // public.profiles (cross-schema, not embeddable) and goes through the
    // profile directory, as every other person on these screens does.
    .select(
      `id, document_id, scl_revision, cpy_revision, reason_for_issue, revision_date, created_at, created_by,
       step:dictionaries!revisions_step_id_fkey(code, label),
       status:dictionaries!revisions_status_id_fkey(code, label),
       acceptance:dictionaries!revisions_acceptance_code_id_fkey(code, label)`,
    )
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw new Error(`listRevisionsWithFiles: ${error.message}`)
  return data
}

/**
 * Every revision of one document, newest first, each with its files.
 *
 * Files are a second query rather than an embed for the reason getRevisionWithFiles
 * gives (composite foreign key, one more thing to get wrong for no gain). Files
 * are read-only metadata: nothing here turns a storage_path into a link — that is
 * 1b.09, and today the lists are empty.
 */
export async function listRevisionsWithFiles(supabase: DbClient, documentId: string) {
  const revisions = await readRevisions(supabase, documentId)
  if (revisions.length === 0) return []

  const { data: files, error } = await supabase
    .schema('dcs')
    .from('files')
    .select('id, revision_id, file_kind, file_name, original_name, storage_path, size_bytes, uploaded_at')
    .in('revision_id', revisions.map((revision) => revision.id))
    .order('sort_order', { ascending: true })
    .order('uploaded_at', { ascending: true })
  if (error) throw new Error(`listRevisionsWithFiles: ${error.message}`)

  const byRevision = new Map<string, NonNullable<typeof files>>()
  for (const file of files ?? []) {
    const list = byRevision.get(file.revision_id) ?? []
    list.push(file)
    byRevision.set(file.revision_id, list)
  }
  return revisions.map((revision) => ({ ...revision, files: byRevision.get(revision.id) ?? [] }))
}

export type RevisionRow = {
  id: string
  sclRevision: string
  cpyRevision: string
  /** "IDC — Internal Discipline Check": the tooltip; the cell shows stepCode. */
  step: string
  stepCode: string
  reason: string
  date: string
  author: string
  /** "1 — Accepted without any comments": the tooltip; the cell shows acceptanceCodeShort. */
  acceptanceCode: string
  acceptanceCodeShort: string
  statusCode: string | null
  /** "SUPERSEDED — Superseded": the tooltip; the badge shows the code. */
  statusLabel: string
  isCurrent: boolean
  files: FileRowView[]
}

/**
 * The rows the Revisions tab draws, every cell already a string. Step, acceptance
 * code and status carry both a short form (the code, which is what fits in the
 * table beside the profile's right-hand panel) and the long "CODE — label" form
 * (the tooltip).
 *
 * Extracted from the component for the reason lib/document-profile.ts exists
 * (no jsdom here, so the decision is tested through the function the component
 * calls). A missing embed — a row RLS hides — degrades to a dash, never throws.
 */
export function toRevisionRows(
  revisions: readonly (RevisionRecord & { files: readonly RevisionFile[] })[],
  currentRevisionId: string | null,
  nameById: ReadonlyMap<string, string | null>,
): RevisionRow[] {
  return revisions.map((revision) => ({
    id: revision.id,
    sclRevision: revision.scl_revision,
    cpyRevision: revision.cpy_revision ?? '—',
    step: dictionaryLabel(revision.step),
    stepCode: revision.step?.code ?? '—',
    reason: revision.reason_for_issue ?? '—',
    date: revision.revision_date ?? '—',
    author: personName(revision.created_by, nameById),
    acceptanceCode: dictionaryLabel(revision.acceptance),
    acceptanceCodeShort: revision.acceptance?.code ?? '—',
    statusCode: revision.status?.code ?? null,
    statusLabel: dictionaryLabel(revision.status),
    isCurrent: revision.id === currentRevisionId,
    files: toFileRows(revision.files),
  }))
}

type RevisionFile = {
  id: string
  file_kind: string
  file_name: string | null
  original_name: string | null
  storage_path: string | null
  size_bytes: number | null
  uploaded_at: string | null
}
