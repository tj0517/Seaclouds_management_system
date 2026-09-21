// DCS 1b.09 (PR 2). Unit tests for the pure half of lib/files.ts: the generated
// name, the index, the key, the input parsing and the error sentences. The
// enforcement (who may upload, who may read bytes) is Postgres' —
// supabase/tests/storage_dcs_documents.test.sql — and the round trip through
// the browser is apps/dcs/e2e/revision-files.mjs.
import { describe, expect, it } from 'vitest'
import {
  buildFileName,
  buildStoragePath,
  COLLISION_MESSAGE,
  FILE_KINDS,
  fileIndexOf,
  fileNameDate,
  fileUploadAccess,
  formatFileIndex,
  mapFileDbError,
  mapStorageError,
  mapUploadHttpError,
  nextFileIndex,
  normaliseExtension,
  parsePrepareUploadInput,
  parseRecordUploadInput,
  revisionFolder,
  TOO_LARGE_MESSAGE,
  UPLOAD_FORBIDDEN_MESSAGE,
  UPLOAD_NETWORK_MESSAGE,
  uploadNetworkError,
} from './files'

const REV = '33333333-3333-4333-8333-333333333333'
const parts = { sclDocNumber: 'SC2602-SCL-RA-A00-00-0001-EN', sclRevision: 'A', stepCode: 'IDC', date: '2026-09-21', ext: 'pdf' }

describe('normaliseExtension', () => {
  it('lower-cases and keeps [a-z0-9] only', () => {
    expect(normaliseExtension('report.PDF')).toBe('pdf')
    expect(normaliseExtension('model.DWG')).toBe('dwg')
    expect(normaliseExtension('archive.tar.gz')).toBe('gz')
    expect(normaliseExtension('weird.ex-t')).toBe('ext')
  })

  it('drops non-ASCII from the extension', () => {
    expect(normaliseExtension('plik.pdfź')).toBe('pdf')
    expect(normaliseExtension('plik.żół')).toBe('')
  })

  it('has no extension for a bare name, a dot-file or a trailing dot', () => {
    expect(normaliseExtension('README')).toBe('')
    expect(normaliseExtension('.bashrc')).toBe('')
    expect(normaliseExtension('name.')).toBe('')
  })
})

describe('fileNameDate', () => {
  const now = new Date('2026-09-21T23:30:00+02:00') // 21:30 UTC on the 21st; the 22nd in Warsaw

  it('uses the revision date when there is one', () => {
    expect(fileNameDate('2026-09-19', now)).toBe('2026-09-19')
  })

  it('falls back to the upload date in UTC when the revision has none', () => {
    expect(fileNameDate(null, now)).toBe('2026-09-21')
    expect(fileNameDate(undefined, now)).toBe('2026-09-21')
    // Past midnight UTC it is the next day, whatever the machine's zone says.
    expect(fileNameDate(null, new Date('2026-09-22T00:10:00Z'))).toBe('2026-09-22')
  })

  it('does not trust a revision date in another shape', () => {
    expect(fileNameDate('19/09/2026', now)).toBe('2026-09-21')
  })
})

describe('fileIndexOf / nextFileIndex / formatFileIndex', () => {
  it('reads NN from a generated name, with or without an extension', () => {
    expect(fileIndexOf('SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_01.pdf')).toBe(1)
    expect(fileIndexOf('SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_10')).toBe(10)
    expect(fileIndexOf('SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_100.docx')).toBe(100)
  })

  it('ignores a name in another shape', () => {
    expect(fileIndexOf('Survey report draft.docx')).toBeNull()
    expect(fileIndexOf('x_1.pdf')).toBeNull() // one digit is not an index
  })

  // Acceptance 4: 01 -> 02 -> 10.
  it('rolls over 01 -> 02 -> 10 and starts at 1 on an empty revision', () => {
    expect(nextFileIndex([])).toBe(1)
    expect(nextFileIndex(['X_A_IDC_2026-09-21_01.pdf'])).toBe(2)
    expect(nextFileIndex(['X_A_IDC_2026-09-21_01.pdf', 'X_A_IDC_2026-09-21_09.pdf'])).toBe(10)
    expect(nextFileIndex(['X_A_IDC_2026-09-21_10.pdf'])).toBe(11)
  })

  it('takes the max, not the count: a gap is never refilled', () => {
    expect(nextFileIndex(['X_A_IDC_2026-09-21_01.pdf', 'X_A_IDC_2026-09-21_07.pdf'])).toBe(8)
  })

  it('reads the index from objects in the folder as well as from rows (same name shape)', () => {
    // A row for 01 and an orphan object for 02 whose row was never written: 03, not a collision on 02.
    expect(nextFileIndex(['X_A_IDC_2026-09-21_01.pdf', 'X_A_IDC_2026-09-21_02.pdf'])).toBe(3)
  })

  it('pads to two digits and no further', () => {
    expect(formatFileIndex(1)).toBe('01')
    expect(formatFileIndex(10)).toBe('10')
    expect(formatFileIndex(100)).toBe('100')
  })
})

describe('buildFileName', () => {
  it('follows [SCL_DOC_NUMBER]_[SCL_REV]_[STEP]_[YYYY-MM-DD]_[NN].[ext]', () => {
    expect(buildFileName({ ...parts, index: 1 })).toBe('SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_01.pdf')
    expect(buildFileName({ ...parts, sclRevision: '00', stepCode: 'IFR', index: 12, ext: 'dwg' })).toBe(
      'SC2602-SCL-RA-A00-00-0001-EN_00_IFR_2026-09-21_12.dwg',
    )
  })

  it('ends with the index when there is no extension', () => {
    expect(buildFileName({ ...parts, index: 3, ext: '' })).toBe('SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_03')
  })

  // Acceptance 4: the user's name never reaches file_name.
  it('never contains the original name — spaces and non-ASCII cannot get in', () => {
    const original = 'Zażółć gęślą JAŹŃ  final (2).PDF'
    const name = buildFileName({ ...parts, index: 2, ext: normaliseExtension(original) })
    expect(name).toBe('SC2602-SCL-RA-A00-00-0001-EN_A_IDC_2026-09-21_02.pdf')
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(name).not.toMatch(/\s/)
  })
})

describe('revisionFolder / buildStoragePath', () => {
  it('keys the object on the project code first', () => {
    expect(revisionFolder({ projectCode: 'SC2602', sclDocNumber: parts.sclDocNumber, sclRevision: 'A' })).toBe('SC2602/SC2602-SCL-RA-A00-00-0001-EN/A')
    expect(buildStoragePath({ projectCode: 'SC2602', sclDocNumber: parts.sclDocNumber, sclRevision: 'A', fileName: 'n_01.pdf' })).toBe(
      'SC2602/SC2602-SCL-RA-A00-00-0001-EN/A/n_01.pdf',
    )
  })

  it('refuses a segment that would change folders', () => {
    expect(() => revisionFolder({ projectCode: 'SC2602/x', sclDocNumber: 'D', sclRevision: 'A' })).toThrow(/project_code/)
    expect(() => revisionFolder({ projectCode: 'SC2602', sclDocNumber: '', sclRevision: 'A' })).toThrow(/scl_doc_number/)
    expect(() => revisionFolder({ projectCode: 'SC2602', sclDocNumber: 'D', sclRevision: '..' })).toThrow(/scl_revision/)
  })
})

describe('parsePrepareUploadInput', () => {
  it('accepts a uuid, a kind from the CHECK list and a name', () => {
    expect(parsePrepareUploadInput({ revisionId: REV, fileKind: 'original', originalName: ' report.pdf ' })).toEqual({
      ok: true,
      data: { revisionId: REV, fileKind: 'original', originalName: 'report.pdf' },
    })
  })

  it('refuses a kind outside original | rendition | attachment | comment_sheet', () => {
    expect(FILE_KINDS).toEqual(['original', 'rendition', 'attachment', 'comment_sheet'])
    expect(parsePrepareUploadInput({ revisionId: REV, fileKind: 'sketch', originalName: 'a.pdf' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it('refuses a missing file, a non-uuid and a name over 255 characters', () => {
    expect(parsePrepareUploadInput({ revisionId: REV, fileKind: 'original', originalName: '  ' })).toMatchObject({ ok: false, error: 'invalid_input', message: 'Choose a file.' })
    expect(parsePrepareUploadInput({ revisionId: 'nope', fileKind: 'original', originalName: 'a.pdf' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parsePrepareUploadInput({ revisionId: REV, fileKind: 'original', originalName: 'a'.repeat(256) })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parsePrepareUploadInput(null)).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})

describe('parseRecordUploadInput', () => {
  const base = { revisionId: REV, fileKind: 'attachment', originalName: 'a.pdf', fileName: 'X_A_IDC_2026-09-21_01.pdf', storagePath: 'SC2602/X/A/X_A_IDC_2026-09-21_01.pdf' }

  it('accepts the size and an optional mime type', () => {
    expect(parseRecordUploadInput({ ...base, sizeBytes: 10, mimeType: 'application/pdf' })).toMatchObject({ ok: true, data: { sizeBytes: 10, mimeType: 'application/pdf' } })
    expect(parseRecordUploadInput({ ...base, sizeBytes: 0, mimeType: '' })).toMatchObject({ ok: true, data: { mimeType: null } })
    expect(parseRecordUploadInput({ ...base, sizeBytes: 0 })).toMatchObject({ ok: true, data: { mimeType: null } })
  })

  it('refuses a negative or fractional size and a missing name or path', () => {
    expect(parseRecordUploadInput({ ...base, sizeBytes: -1 })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseRecordUploadInput({ ...base, sizeBytes: 1.5 })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseRecordUploadInput({ ...base, fileName: '', sizeBytes: 1 })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseRecordUploadInput({ ...base, storagePath: '', sizeBytes: 1 })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})

// Acceptance 4: the 409 collision path returns a readable error.
describe('mapUploadHttpError', () => {
  it('turns Storage’s 409 into the collision sentence', () => {
    const result = mapUploadHttpError(409, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')
    expect(result).toEqual({ ok: false, error: 'collision', message: COLLISION_MESSAGE })
    expect(COLLISION_MESSAGE).toMatch(/Try again/)
  })

  it('turns 413, and the storage-api’s 400 with its size message, into the size sentence', () => {
    expect(mapUploadHttpError(413, '')).toMatchObject({ error: 'too_large', message: TOO_LARGE_MESSAGE })
    expect(mapUploadHttpError(400, '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}')).toMatchObject({ error: 'too_large' })
  })

  it('turns 403 into the policy sentence and keeps an unknown status readable', () => {
    expect(mapUploadHttpError(403, '')).toMatchObject({ error: 'forbidden', message: UPLOAD_FORBIDDEN_MESSAGE })
    expect(mapUploadHttpError(500, 'boom')).toMatchObject({ error: 'storage_error', message: 'The upload was refused (HTTP 500): boom' })
  })

  // PR #81 review round 3: a PUT that ends without a status (network, abort, timeout) is a sentence too,
  // and one that says the file can be tried again — nothing was stored.
  it('gives a PUT that got no HTTP answer its own sentence, which invites a retry', () => {
    expect(uploadNetworkError()).toEqual({ ok: false, error: 'storage_error', message: UPLOAD_NETWORK_MESSAGE })
    expect(UPLOAD_NETWORK_MESSAGE).toMatch(/try again/)
  })
})

describe('mapStorageError', () => {
  it('answers every download refusal with the one sentence', () => {
    for (const error of [{ message: 'Object not found', statusCode: '404' }, { message: 'new row violates row-level security policy', statusCode: '403' }, { message: 'anything' }]) {
      expect(mapStorageError(error, 'download')).toMatchObject({ error: 'forbidden' })
      expect(mapStorageError(error, 'download').message).toMatch(/not available to you/)
    }
  })

  it('tells an upload refusal, a collision and a size refusal apart', () => {
    expect(mapStorageError({ message: 'new row violates row-level security policy', statusCode: '403' }, 'upload')).toMatchObject({ error: 'forbidden' })
    expect(mapStorageError({ message: 'The resource already exists', statusCode: '409' }, 'upload')).toMatchObject({ error: 'collision' })
    expect(mapStorageError({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }, 'upload')).toMatchObject({ error: 'too_large' })
  })
})

describe('mapFileDbError', () => {
  it('reads 42501 as the INSERT policy and the CHECK / NOT NULL codes as input', () => {
    expect(mapFileDbError('42501', 'x')).toMatchObject({ error: 'forbidden', message: UPLOAD_FORBIDDEN_MESSAGE })
    expect(mapFileDbError('23514', 'bad kind')).toMatchObject({ error: 'invalid_input', message: 'bad kind' })
    expect(mapFileDbError('23502', 'null')).toMatchObject({ error: 'invalid_input' })
    expect(mapFileDbError('XX000', 'other')).toMatchObject({ error: 'db_error', message: 'other' })
  })
})

describe('fileUploadAccess — mirrors the three INSERT policies', () => {
  const on = { hasRevision: true, isAdmin: false, isOrig: false, isDc: false, aal2: false }

  it('is enabled for an Originator at any aal, a DC at aal2, and an admin', () => {
    expect(fileUploadAccess({ ...on, isOrig: true })).toEqual({ mode: 'enabled' })
    expect(fileUploadAccess({ ...on, isDc: true, aal2: true })).toEqual({ mode: 'enabled' })
    expect(fileUploadAccess({ ...on, isAdmin: true })).toEqual({ mode: 'enabled' })
  })

  it('tells a DC at aal1 what to fix, and everyone else that it is a role', () => {
    expect(fileUploadAccess({ ...on, isDc: true })).toMatchObject({ mode: 'disabled', reason: 'needs_second_factor' })
    expect(fileUploadAccess(on)).toMatchObject({ mode: 'disabled', reason: 'not_allowed' })
  })

  // A viewer reads bytes (SELECT policy) but adds nothing (no INSERT policy for view).
  it('is not enabled by the view role', () => {
    expect(fileUploadAccess(on)).toMatchObject({ mode: 'disabled' })
  })

  it('says "no revision" first, whoever is asking', () => {
    expect(fileUploadAccess({ ...on, hasRevision: false, isAdmin: true })).toMatchObject({ mode: 'disabled', reason: 'no_revision' })
  })
})
