// DCS 1b.09 (PR 2 of 2): files on a revision — the generated name, the object
// key, the signed upload and the signed download.
//
// Same split as lib/revisions.ts: takes any typed Supabase client and imports
// nothing from Next.js, so it runs from a server action and a Vitest test
// alike. The 'use server' wrappers live in app/data/actions/files.ts.
//
// THE RULE THIS FILE LIVES UNDER (CLAUDE.md): the database is the enforcement,
// this file is the message. Who may upload and who may read bytes is decided by
// the storage.objects policies of migration 20260921112840 (PR 1):
//
//   upload  INSERT "Originators upload…" (orig, any aal), "Doc controllers
//           upload…" (dc AND aal2), "Admins upload…"
//   read    SELECT "Project role holders read…" (any dcs.project_roles row on
//           the project), "Admins read…" — NOT is_project_member: a Timesheet
//           assignment alone reads dcs.files metadata but no bytes (O-16)
//   update, delete   no policy: no overwrite, no delete through the API
//
// BOTH signing calls below run on the caller's own session client. That is the
// whole design: the storage-api evaluates those policies as the caller when it
// signs (an upload URL is refused to someone the INSERT policy refuses; a
// download URL to someone the SELECT policy refuses). An admin client — one
// holding the key that bypasses RLS — would sign anything and undo PR 1;
// this module is imported by client components and never holds such a key.
//
// What this file does decide, because nothing in the database does yet:
//   - the generated file name  [SCL_DOC_NUMBER]_[SCL_REV]_[STEP]_[YYYY-MM-DD]_[NN].[ext]
//   - the object key           {project_code}/{scl_doc_number}/{scl_revision}/{file_name}
//   - NN = max existing NN on the revision + 1 (dcs.files rows AND objects
//     already in the revision's folder, so an object whose row was never
//     written does not block its number forever); no UNIQUE constraint, so a
//     collision surfaces as Storage's 409 and is shown as a sentence.
// Audit of downloads is out of scope (docs/deferred-tasks.md, bbb).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert } from '@scl/db'

type DbClient = SupabaseClient<Database>
type FileInsert = TablesInsert<{ schema: 'dcs' }, 'files'>

export const DCS_DOCUMENTS_BUCKET = 'dcs-documents'
/** How long a download URL lives. Sixty seconds: long enough to click, short enough not to be a link worth sharing. */
export const DOWNLOAD_URL_SECONDS = 60

export const FILE_KINDS = ['original', 'rendition', 'attachment', 'comment_sheet'] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** What the kind means to a person; the codes themselves are the CHECK constraint's (files_file_kind_check). */
export const FILE_KIND_LABELS: Readonly<Record<FileKind, string>> = {
  original: 'Original (native file)',
  rendition: 'Rendition (PDF)',
  attachment: 'Attachment',
  comment_sheet: 'Comment sheet',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ORIGINAL_NAME = 255

// ---------------------------------------------------------------------------
// The generated name — pure
// ---------------------------------------------------------------------------

/**
 * The extension part of the generated name: whatever follows the last dot,
 * lower-cased, with everything outside [a-z0-9] dropped (so non-ASCII goes,
 * and so does a stray dash or space). A name with no dot, a leading dot only
 * (".bashrc") or a trailing dot has no extension, and the generated name then
 * ends with the index and no dot.
 */
export function normaliseExtension(originalName: string): string {
  const dot = originalName.lastIndexOf('.')
  if (dot <= 0 || dot === originalName.length - 1) return ''
  return originalName
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * The date in the name: the revision's own date when it has one, otherwise the
 * upload moment in UTC — fixed to UTC for the reason formatTimestamp gives
 * (Vercel is UTC, a developer's machine is not).
 */
export function fileNameDate(revisionDate: string | null | undefined, now: Date): string {
  if (revisionDate && /^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) return revisionDate
  return now.toISOString().slice(0, 10)
}

/** The NN of a name built by buildFileName (also of a name built by hand in the same shape), or null. */
export function fileIndexOf(name: string): number | null {
  const match = /_(\d{2,})(?:\.[a-z0-9]+)?$/.exec(name)
  return match ? Number(match[1]) : null
}

/**
 * The next index on a revision: the largest index any existing name carries,
 * plus one; 1 when nothing is there. Names in another shape are ignored — the
 * index is read from the name because nothing else stores it.
 */
export function nextFileIndex(existingNames: readonly string[]): number {
  let max = 0
  for (const name of existingNames) {
    const index = fileIndexOf(name)
    if (index !== null && index > max) max = index
  }
  return max + 1
}

/** Two digits, more when the revision has passed 99 files: 01, 02, …, 10, …, 100. */
export function formatFileIndex(index: number): string {
  return String(index).padStart(2, '0')
}

export type FileNameParts = {
  sclDocNumber: string
  sclRevision: string
  stepCode: string
  /** YYYY-MM-DD, from fileNameDate. */
  date: string
  index: number
  /** Already normalised (normaliseExtension); '' means no extension. */
  ext: string
}

/** [SCL_DOC_NUMBER]_[SCL_REV]_[STEP]_[YYYY-MM-DD]_[NN].[ext] — the user's own name never reaches this. */
export function buildFileName(parts: FileNameParts): string {
  const base = `${parts.sclDocNumber}_${parts.sclRevision}_${parts.stepCode}_${parts.date}_${formatFileIndex(parts.index)}`
  return parts.ext ? `${base}.${parts.ext}` : base
}

/**
 * A path segment as the storage policies and the bucket layout expect it: no
 * slash (a slash would move the object into another folder and, for the first
 * segment, under another project's policy), nothing empty. The values come from
 * the database (project_code is format-checked and immutable, the SCL number
 * and revision are generated), so this is a belt on top of braces.
 */
function assertSegment(value: string, what: string): string {
  if (value === '' || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(`${what} is not a valid path segment: ${JSON.stringify(value)}`)
  }
  return value
}

/** The revision's folder in the bucket: {project_code}/{scl_doc_number}/{scl_revision}. */
export function revisionFolder(input: { projectCode: string; sclDocNumber: string; sclRevision: string }): string {
  return [
    assertSegment(input.projectCode, 'project_code'),
    assertSegment(input.sclDocNumber, 'scl_doc_number'),
    assertSegment(input.sclRevision, 'scl_revision'),
  ].join('/')
}

/** {project_code}/{scl_doc_number}/{scl_revision}/{file_name} — the first segment is what the policies key on. */
export function buildStoragePath(input: { projectCode: string; sclDocNumber: string; sclRevision: string; fileName: string }): string {
  return `${revisionFolder(input)}/${assertSegment(input.fileName, 'file_name')}`
}

// ---------------------------------------------------------------------------
// Errors and input
// ---------------------------------------------------------------------------

export type FileError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'not_found'
  | 'collision'
  | 'too_large'
  | 'storage_error'
  | 'db_error'

export type FileResult<T> = { ok: true; data: T } | { ok: false; error: FileError; message?: string }

function fail(error: FileError, message?: string): { ok: false; error: FileError; message?: string } {
  return { ok: false, error, message }
}

/**
 * "Forbidden" and "not found" are one sentence on purpose: the download action
 * answers a row RLS hides, an object the SELECT policy hides and an object that
 * is not there with the same words, so the button cannot be used to learn which
 * of the three it was.
 */
export const FILE_NOT_AVAILABLE_MESSAGE =
  'This file is not available to you. It may not exist, or your role on the project does not include reading its content.'

export const UPLOAD_FORBIDDEN_MESSAGE =
  'You cannot add files to this revision. You need the Originator role on the project — or, as its Document Controller, a session with a verified second factor.'

export const COLLISION_MESSAGE =
  'A file with this generated name already exists on the revision — most likely someone just added one. Try again: the next number will be used.'

export const TOO_LARGE_MESSAGE = 'The file is larger than the 100 MiB limit of the document store.'

/**
 * The PUT to the signed URL never got an HTTP answer (the connection dropped,
 * the request was aborted or timed out). Nothing was stored — the storage-api
 * writes an object only on a completed body — so the same upload can be tried
 * again; the next attempt signs a fresh URL and recomputes NN.
 */
export const UPLOAD_NETWORK_MESSAGE = 'The upload did not reach the document store. Check the connection and try again.'

/** The refusal shown when the browser's PUT ended without a status: a network error, an abort, a timeout. */
export function uploadNetworkError(): { ok: false; error: FileError; message?: string } {
  return fail('storage_error', UPLOAD_NETWORK_MESSAGE)
}

/**
 * One of the two server-action calls of an upload threw instead of answering
 * (the request never reached the app, or the app answered something that is
 * not a server-action response — a sign-in page, a gateway error). Shown as a
 * sentence so the dialog never sits on "Adding…" with nothing to read.
 */
export const UPLOAD_REQUEST_MESSAGE = 'The request to the server failed. Reload the page and try again.'

export function uploadRequestError(): { ok: false; error: FileError; message?: string } {
  return fail('storage_error', UPLOAD_REQUEST_MESSAGE)
}

export function isFileKind(value: unknown): value is FileKind {
  return typeof value === 'string' && (FILE_KINDS as readonly string[]).includes(value)
}

export type PrepareUploadInput = {
  revisionId: string
  fileKind: FileKind
  originalName: string
}

/** Validates the client's request for an upload URL. Nothing here is trusted beyond its shape. */
export function parsePrepareUploadInput(raw: unknown): FileResult<PrepareUploadInput> {
  if (typeof raw !== 'object' || raw === null) return fail('invalid_input', 'payload is not an object')
  const r = raw as Record<string, unknown>
  if (typeof r.revisionId !== 'string' || !UUID_RE.test(r.revisionId)) return fail('invalid_input', 'revisionId is required and must be a uuid')
  if (!isFileKind(r.fileKind)) return fail('invalid_input', `fileKind must be one of ${FILE_KINDS.join(', ')}`)
  if (typeof r.originalName !== 'string') return fail('invalid_input', 'originalName is required')
  const originalName = r.originalName.trim()
  if (originalName === '') return fail('invalid_input', 'Choose a file.')
  if (originalName.length > MAX_ORIGINAL_NAME) return fail('invalid_input', `The file name is longer than ${MAX_ORIGINAL_NAME} characters.`)
  return { ok: true, data: { revisionId: r.revisionId, fileKind: r.fileKind, originalName } }
}

export type RecordUploadInput = PrepareUploadInput & {
  fileName: string
  storagePath: string
  sizeBytes: number
  mimeType: string | null
}

/** Validates what the client reports after the bytes are in the bucket. */
export function parseRecordUploadInput(raw: unknown): FileResult<RecordUploadInput> {
  const base = parsePrepareUploadInput(raw)
  if (!base.ok) return base
  const r = raw as Record<string, unknown>
  if (typeof r.fileName !== 'string' || r.fileName === '') return fail('invalid_input', 'fileName is required')
  if (typeof r.storagePath !== 'string' || r.storagePath === '') return fail('invalid_input', 'storagePath is required')
  if (typeof r.sizeBytes !== 'number' || !Number.isInteger(r.sizeBytes) || r.sizeBytes < 0) {
    return fail('invalid_input', 'sizeBytes must be a non-negative integer')
  }
  let mimeType: string | null = null
  if (r.mimeType !== undefined && r.mimeType !== null) {
    if (typeof r.mimeType !== 'string') return fail('invalid_input', 'mimeType must be a string')
    mimeType = r.mimeType.trim() === '' ? null : r.mimeType.trim().slice(0, 255)
  }
  return {
    ok: true,
    data: { ...base.data, fileName: r.fileName, storagePath: r.storagePath, sizeBytes: r.sizeBytes, mimeType },
  }
}

/**
 * The storage-api's answer to the browser's PUT, as a sentence. 409 is the
 * collision the name rule allows for (no UNIQUE constraint — two people can
 * compute the same NN); 413, or the storage-api's 400 with its size message,
 * is the bucket / global limit; 403 is the INSERT policy. Anything else keeps
 * its status and text rather than being guessed at.
 */
export function mapUploadHttpError(status: number, body: string): { ok: false; error: FileError; message?: string } {
  const text = body.trim()
  if (status === 409 || /already exists|Duplicate/i.test(text)) return fail('collision', COLLISION_MESSAGE)
  if (status === 413 || /exceeded the maximum allowed size|EntityTooLarge|Payload too large/i.test(text)) return fail('too_large', TOO_LARGE_MESSAGE)
  if (status === 403 || status === 401) return fail('forbidden', UPLOAD_FORBIDDEN_MESSAGE)
  return fail('storage_error', `The upload was refused (HTTP ${status})${text ? `: ${text.slice(0, 200)}` : '.'}`)
}

/** A storage-js error (from signing) as a sentence; same rules as the HTTP one, read from its message and status. */
export function mapStorageError(error: { message: string; statusCode?: string | number }, context: 'upload' | 'download'): { ok: false; error: FileError; message?: string } {
  const status = Number(error.statusCode ?? 0)
  if (context === 'download') return fail('forbidden', FILE_NOT_AVAILABLE_MESSAGE)
  if (status === 409 || /already exists|Duplicate/i.test(error.message)) return fail('collision', COLLISION_MESSAGE)
  if (status === 413 || /exceeded the maximum allowed size/i.test(error.message)) return fail('too_large', TOO_LARGE_MESSAGE)
  if (status === 403 || status === 401 || /not authorized|violates row-level security|Unauthorized/i.test(error.message)) {
    return fail('forbidden', UPLOAD_FORBIDDEN_MESSAGE)
  }
  return fail('storage_error', error.message)
}

/** A PostgREST error from the dcs.files insert. 42501 is the INSERT policy; 23514 is the file_kind CHECK. */
export function mapFileDbError(code: string | undefined, message: string): { ok: false; error: FileError; message?: string } {
  switch (code) {
    case '42501':
      return fail('forbidden', UPLOAD_FORBIDDEN_MESSAGE)
    case '23514':
    case '23502':
    case '23503':
      return fail('invalid_input', message)
    default:
      return fail('db_error', message)
  }
}

// ---------------------------------------------------------------------------
// Who sees the Add File control — mirrors, does not enforce
// ---------------------------------------------------------------------------

export type FileUploadAccess =
  | { mode: 'enabled' }
  | { mode: 'disabled'; reason: 'no_revision' | 'needs_second_factor' | 'not_allowed'; hint: string }

/**
 * Whether Add File is live for this reader. MIRRORS the three INSERT policies on
 * storage.objects and dcs.files (orig at any aal; dc at aal2; admin) — a wrong
 * answer here can only offer a control the database then refuses, or withhold
 * one it would have allowed. Checked first: a document with no revision has
 * nothing to attach a file to.
 */
export function fileUploadAccess(input: { hasRevision: boolean; isAdmin: boolean; isOrig: boolean; isDc: boolean; aal2: boolean }): FileUploadAccess {
  if (!input.hasRevision) {
    return { mode: 'disabled', reason: 'no_revision', hint: 'Files are added to a revision. Issue the first revision with New Revision.' }
  }
  if (input.isAdmin || input.isOrig || (input.isDc && input.aal2)) return { mode: 'enabled' }
  if (input.isDc) {
    return {
      mode: 'disabled',
      reason: 'needs_second_factor',
      hint: 'Adding files as Document Controller needs a session with a verified second factor.',
    }
  }
  return {
    mode: 'disabled',
    reason: 'not_allowed',
    hint: 'Only an Originator or the Document Controller of this project can add files.',
  }
}

// ---------------------------------------------------------------------------
// The revision's context — one read, shared by prepare and record
// ---------------------------------------------------------------------------

type RevisionContext = {
  revisionId: string
  documentId: string
  projectId: string
  projectCode: string
  sclDocNumber: string
  sclRevision: string
  stepCode: string
  revisionDate: string | null
  /** file_name of every dcs.files row on the revision the caller can see. */
  existingFileNames: string[]
}

async function readRevisionContext(supabase: DbClient, revisionId: string): Promise<FileResult<RevisionContext>> {
  const { data: revision, error: revisionError } = await supabase
    .schema('dcs')
    .from('revisions')
    .select('id, document_id, project_id, scl_revision, revision_date, step:dictionaries!revisions_step_id_fkey(code)')
    .eq('id', revisionId)
    .maybeSingle()
  if (revisionError) return mapFileDbError(revisionError.code, revisionError.message)
  // A revision RLS hides and one that does not exist are the same answer, as on the profile page.
  if (!revision) return fail('not_found', 'This revision is not visible to you, or does not exist.')
  if (!revision.step?.code) return fail('db_error', 'The revision has no workflow step.')

  const [{ data: document, error: documentError }, { data: project, error: projectError }, { data: files, error: filesError }] =
    await Promise.all([
      supabase.schema('dcs').from('documents').select('scl_doc_number').eq('id', revision.document_id).maybeSingle(),
      supabase.from('projects').select('project_code').eq('id', revision.project_id).maybeSingle(),
      supabase.schema('dcs').from('files').select('file_name').eq('revision_id', revision.id),
    ])
  if (documentError) return mapFileDbError(documentError.code, documentError.message)
  if (projectError) return mapFileDbError(projectError.code, projectError.message)
  if (filesError) return mapFileDbError(filesError.code, filesError.message)
  if (!document) return fail('not_found', 'This document is not visible to you, or does not exist.')
  if (!project) return fail('not_found', 'The project of this revision is not visible to you.')

  return {
    ok: true,
    data: {
      revisionId: revision.id,
      documentId: revision.document_id,
      projectId: revision.project_id,
      projectCode: project.project_code,
      sclDocNumber: document.scl_doc_number,
      sclRevision: revision.scl_revision,
      stepCode: revision.step.code,
      revisionDate: revision.revision_date,
      existingFileNames: (files ?? []).map((file) => file.file_name),
    },
  }
}

// ---------------------------------------------------------------------------
// Prepare: the name, the key and a signed upload URL
// ---------------------------------------------------------------------------

export type PreparedUpload = {
  fileName: string
  storagePath: string
  /** The URL the browser PUTs the bytes to; valid briefly, single use. */
  signedUrl: string
  index: number
}

/**
 * Generates the name and the key and signs an upload URL for them — on the
 * caller's session, so the storage-api applies the INSERT policies of PR 1 as
 * the caller before it signs anything. NN is read from the dcs.files rows AND
 * from the objects already in the revision's folder (see the header).
 */
export async function prepareUpload(supabase: DbClient, rawInput: unknown, now: Date = new Date()): Promise<FileResult<PreparedUpload>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  const parsed = parsePrepareUploadInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  const context = await readRevisionContext(supabase, input.revisionId)
  if (!context.ok) return context
  const ctx = context.data

  let folder: string
  try {
    folder = revisionFolder(ctx)
  } catch (error) {
    return fail('db_error', error instanceof Error ? error.message : String(error))
  }

  // Objects already in the folder: the SELECT policy decides what the caller
  // sees (the same people who may upload may read), and an object whose row was
  // never written still takes its number.
  const { data: objects, error: listError } = await supabase.storage.from(DCS_DOCUMENTS_BUCKET).list(folder, { limit: 1000 })
  if (listError) return mapStorageError(listError, 'upload')

  const index = nextFileIndex([...ctx.existingFileNames, ...(objects ?? []).map((object) => object.name)])
  const fileName = buildFileName({
    sclDocNumber: ctx.sclDocNumber,
    sclRevision: ctx.sclRevision,
    stepCode: ctx.stepCode,
    date: fileNameDate(ctx.revisionDate, now),
    index,
    ext: normaliseExtension(input.originalName),
  })
  const storagePath = `${folder}/${fileName}`

  const { data: signed, error: signError } = await supabase.storage.from(DCS_DOCUMENTS_BUCKET).createSignedUploadUrl(storagePath)
  if (signError) return mapStorageError(signError, 'upload')
  return { ok: true, data: { fileName, storagePath, signedUrl: signed.signedUrl, index } }
}

// ---------------------------------------------------------------------------
// Record: the dcs.files row, once the bytes are in
// ---------------------------------------------------------------------------

/**
 * Writes the index row for an object the browser has just uploaded. The name
 * and the key are checked against the revision again rather than trusted: the
 * row must point inside this revision's own folder, at a name in the generated
 * shape, so a hand-made call cannot make a row point at another project's
 * object (the SELECT policy would refuse the download anyway; this keeps the
 * index honest). project_id is the revision's, held by the composite FK;
 * uploaded_by is the session's user, never the payload's.
 */
export async function recordUpload(supabase: DbClient, rawInput: unknown): Promise<FileResult<{ id: string; documentId: string; fileName: string }>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  const parsed = parseRecordUploadInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.data

  const context = await readRevisionContext(supabase, input.revisionId)
  if (!context.ok) return context
  const ctx = context.data

  let folder: string
  try {
    folder = revisionFolder(ctx)
  } catch (error) {
    return fail('db_error', error instanceof Error ? error.message : String(error))
  }
  if (input.storagePath !== `${folder}/${input.fileName}`) return fail('invalid_input', 'storagePath does not belong to this revision')
  if (!input.fileName.startsWith(`${ctx.sclDocNumber}_${ctx.sclRevision}_${ctx.stepCode}_`) || fileIndexOf(input.fileName) === null) {
    return fail('invalid_input', 'fileName is not in the generated shape for this revision')
  }

  const payload: FileInsert = {
    revision_id: ctx.revisionId,
    project_id: ctx.projectId,
    file_kind: input.fileKind,
    file_name: input.fileName,
    original_name: input.originalName,
    storage_path: input.storagePath,
    size_bytes: input.sizeBytes,
    mime_type: input.mimeType,
    uploaded_by: user.id,
    sort_order: fileIndexOf(input.fileName) ?? 0,
  }
  const { data, error } = await supabase.schema('dcs').from('files').insert(payload).select('id').single()
  if (error) return mapFileDbError(error.code, error.message)
  return { ok: true, data: { id: data.id, documentId: ctx.documentId, fileName: input.fileName } }
}

// ---------------------------------------------------------------------------
// Download: a short-lived signed URL, on the caller's session
// ---------------------------------------------------------------------------

/**
 * A signed download URL for one file row, valid DOWNLOAD_URL_SECONDS, served as
 * an attachment under the generated name. The row is read under RLS (so a
 * Timesheet-only member sees it — metadata) and the URL is signed under the
 * caller's session (so the same member is refused — bytes, O-16). Every refusal
 * and a missing object come back as the one FILE_NOT_AVAILABLE_MESSAGE.
 */
export async function downloadUrl(supabase: DbClient, rawInput: unknown): Promise<FileResult<{ url: string; fileName: string }>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated')

  if (typeof rawInput !== 'object' || rawInput === null) return fail('invalid_input', 'payload is not an object')
  const r = rawInput as Record<string, unknown>
  if (typeof r.fileId !== 'string' || !UUID_RE.test(r.fileId)) return fail('invalid_input', 'fileId is required and must be a uuid')

  const { data: file, error } = await supabase.schema('dcs').from('files').select('storage_path, file_name').eq('id', r.fileId).maybeSingle()
  if (error) return mapFileDbError(error.code, error.message)
  if (!file) return fail('forbidden', FILE_NOT_AVAILABLE_MESSAGE)

  const { data: signed, error: signError } = await supabase.storage
    .from(DCS_DOCUMENTS_BUCKET)
    .createSignedUrl(file.storage_path, DOWNLOAD_URL_SECONDS, { download: file.file_name })
  if (signError) return mapStorageError(signError, 'download')
  return { ok: true, data: { url: signed.signedUrl, fileName: file.file_name } }
}
