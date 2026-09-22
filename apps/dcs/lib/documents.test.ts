// DCS 1b.04. Unit tests for the decisions in lib/documents.ts — the parts that
// run before any database is involved. The rules themselves are proven against
// Postgres in supabase/tests/documents_originator_not_checker.test.sql and
// supabase/tests/documents_require_mdr_settings.test.sql; these cover the
// app-side duplicates that decide what the user is told.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  DEFAULT_LANGUAGE_CODE,
  DOCUMENT_STATUS_CODES,
  budgetHoursFromMeta,
  creatableProjects,
  defaultLanguageId,
  documentStatusAccess,
  documentStatusOptions,
  isUuid,
  mapCpyDbError,
  mapDbError,
  mapDocumentStatusDbError,
  originatorIsChecker,
  parseCreateDocumentInput,
  parseSetCpyNumberInput,
  parseSetDocumentStatusInput,
  parseVoidDocumentInput,
  resolveProjectFromParam,
  setCpyNumber,
  setDocumentStatus,
  voidDocument,
  voidDocumentAccess,
} from './documents'
import type { ProjectRole } from './auth-helpers'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const validInput = {
  projectId: A,
  title: 'Geophysical survey report, Baltic Sea, Poland',
  docTypeId: B,
  disciplineId: C,
  areaId: A,
  languageId: B,
}

describe('budgetHoursFromMeta', () => {
  it('reads budget_hours from a doc_type meta object', () => {
    expect(budgetHoursFromMeta({ budget_hours: 60 })).toBe(60)
  })

  // The ZZT row on scl-dev: meta = {}. 24 of 25 doc_type rows carry the key,
  // and this is the 25th. It must not throw and must not pre-fill.
  it('returns null for the seeded doc_type whose meta is empty', () => {
    expect(budgetHoursFromMeta({})).toBeNull()
  })

  it('returns null rather than throwing for every unusable shape', () => {
    expect(budgetHoursFromMeta(null)).toBeNull()
    expect(budgetHoursFromMeta(undefined)).toBeNull()
    expect(budgetHoursFromMeta([1, 2])).toBeNull()
    expect(budgetHoursFromMeta('60')).toBeNull()
    expect(budgetHoursFromMeta({ budget_hours: '60' })).toBeNull()
    expect(budgetHoursFromMeta({ budget_hours: null })).toBeNull()
  })

  // dcs.documents has CHECK (budget_hours >= 0), so a negative pre-fill would
  // build a form whose own default cannot be saved.
  it('refuses a negative suggestion, which the CHECK would reject anyway', () => {
    expect(budgetHoursFromMeta({ budget_hours: -1 })).toBeNull()
  })

  it('accepts zero, which is a legal budget', () => {
    expect(budgetHoursFromMeta({ budget_hours: 0 })).toBe(0)
  })
})

describe('originatorIsChecker', () => {
  it('is true only when the same person holds both slots', () => {
    expect(originatorIsChecker({ originatorId: A, checkerId: A })).toBe(true)
    expect(originatorIsChecker({ originatorId: A, checkerId: B })).toBe(false)
  })

  // The NULL escapes, mirroring the CHECK constraint exactly. Two empty slots
  // are not a collision — `is distinct from` would have called them one, which
  // is why the constraint spells the escapes out.
  it('is false when either slot is empty, including both', () => {
    expect(originatorIsChecker({ originatorId: null, checkerId: null })).toBe(false)
    expect(originatorIsChecker({ originatorId: A, checkerId: null })).toBe(false)
    expect(originatorIsChecker({ originatorId: null, checkerId: A })).toBe(false)
  })
})

describe('parseCreateDocumentInput', () => {
  it('accepts a minimal valid payload and trims the title', () => {
    const result = parseCreateDocumentInput({ ...validInput, title: '  Report  ' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.title).toBe('Report')
      expect(result.data.ctrCode).toBeNull()
      expect(result.data.budgetHours).toBeNull()
    }
  })

  // THE assertion this file exists for. An extra scl_doc_number key on the
  // payload must not reach the insert — the type forbids it, and this proves
  // the runtime drops it too, the way parseUpdateProjectMdrInput drops
  // projectCode.
  it('drops a smuggled scl_doc_number instead of passing it through', () => {
    const result = parseCreateDocumentInput({ ...validInput, scl_doc_number: 'SC2602-SCL-RA-0001-EN' })
    expect(result.ok).toBe(true)
    if (result.ok) expect('scl_doc_number' in result.data).toBe(false)
  })

  it('drops a smuggled cpy_doc_number too — that column belongs to the DC (1b.03)', () => {
    const result = parseCreateDocumentInput({ ...validInput, cpy_doc_number: 'CLIENT-001' })
    expect(result.ok).toBe(true)
    if (result.ok) expect('cpy_doc_number' in result.data).toBe(false)
  })

  it('refuses Originator = Checker with its own error code, not a generic one', () => {
    const result = parseCreateDocumentInput({ ...validInput, originatorId: A, checkerId: A })
    expect(result).toMatchObject({ ok: false, error: 'originator_is_checker' })
  })

  it('allows Originator = Approver and Checker = Approver', () => {
    expect(parseCreateDocumentInput({ ...validInput, originatorId: A, checkerId: B, approverId: A }).ok).toBe(true)
    expect(parseCreateDocumentInput({ ...validInput, originatorId: A, checkerId: B, approverId: B }).ok).toBe(true)
  })

  it('requires a title', () => {
    expect(parseCreateDocumentInput({ ...validInput, title: '   ' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it('requires every dictionary field, since all five are NOT NULL', () => {
    for (const key of ['projectId', 'docTypeId', 'disciplineId', 'areaId', 'languageId'] as const) {
      expect(parseCreateDocumentInput({ ...validInput, [key]: undefined })).toMatchObject({ ok: false })
      expect(parseCreateDocumentInput({ ...validInput, [key]: 'not-a-uuid' })).toMatchObject({ ok: false })
    }
  })

  // The form posts strings; an empty optional select must read as "not set"
  // rather than as an invalid uuid.
  it('treats an empty string in an optional field as null', () => {
    const result = parseCreateDocumentInput({ ...validInput, ctrCode: '', originatorId: '', checkerId: '' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.ctrCode).toBeNull()
      expect(result.data.originatorId).toBeNull()
    }
  })

  it('accepts budget hours as a numeric string and rejects a negative one', () => {
    const ok = parseCreateDocumentInput({ ...validInput, budgetHours: '60' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data.budgetHours).toBe(60)

    expect(parseCreateDocumentInput({ ...validInput, budgetHours: -1 })).toMatchObject({ ok: false })
    expect(parseCreateDocumentInput({ ...validInput, budgetHours: 'lots' })).toMatchObject({ ok: false })
  })

  // A manually changed value is what gets saved — the acceptance criterion.
  // The parser has no opinion about what the doc type suggested.
  it('keeps a manually entered budget that differs from the type default', () => {
    const result = parseCreateDocumentInput({ ...validInput, budgetHours: 12 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.budgetHours).toBe(12)
  })

  it('accepts zero hours without falling back to null', () => {
    const result = parseCreateDocumentInput({ ...validInput, budgetHours: 0 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.budgetHours).toBe(0)
  })
})

describe('creatableProjects', () => {
  const projects = [{ id: A }, { id: B }, { id: C }]
  const roles = new Map<string, ProjectRole[]>([
    [A, ['orig']],
    [B, ['dc']],
    [C, ['view']],
  ])
  const withMdr = new Set([A, C])

  it('offers projects where the user is ORIG or DC, and no others', () => {
    const result = creatableProjects(projects, roles, withMdr, false)
    expect(result.map((p) => p.id)).toEqual([A, B])
  })

  it('offers everything to an admin, who holds no project_roles rows at all', () => {
    const result = creatableProjects(projects, new Map(), withMdr, true)
    expect(result.map((p) => p.id)).toEqual([A, B, C])
  })

  // The project WITHOUT an mdr_settings row stays in the list, flagged.
  // Filtering it out would make the required "configure the MDR first" message
  // unreachable — the user would just find their project missing.
  it('keeps MDR-less projects in the list and flags them rather than hiding them', () => {
    const result = creatableProjects(projects, roles, withMdr, false)
    expect(result.find((p) => p.id === A)?.hasMdr).toBe(true)
    expect(result.find((p) => p.id === B)?.hasMdr).toBe(false)
  })

  it('offers nothing to someone with no qualifying role anywhere', () => {
    expect(creatableProjects(projects, new Map([[C, ['view']]]), withMdr, false)).toEqual([])
  })
})

// DCS 1b.04b: `?project=` on the New Document link is untrusted input — it
// comes off the URL, not a server read. The security requirement is that it
// is used ONLY when it names a project in the server-computed creatable list
// (creatableProjects' output), never to widen what the form offers.
describe('resolveProjectFromParam', () => {
  const projects = [{ id: A }, { id: B }]

  it('preselects the project when the param names one the caller may create in', () => {
    expect(resolveProjectFromParam(A, projects)).toBe(A)
  })

  it('starts empty when there is no param at all', () => {
    expect(resolveProjectFromParam(undefined, projects)).toBe('')
  })

  it('starts empty for an empty string', () => {
    expect(resolveProjectFromParam('', projects)).toBe('')
  })

  // RED PROOF: this is the case a variant that trusts the parameter as-is
  // (`return param ?? ''`) gets wrong — a real, well-formed project id, just
  // not one in the caller's creatable list (C, unlike A/B above, is not in
  // `projects`). Preselecting it would offer a project the form's own list
  // never included, ahead of the RLS check createDocument still makes.
  it('starts empty for a real project id that is not in the creatable list', () => {
    expect(resolveProjectFromParam(C, projects)).toBe('')
  })

  it('starts empty for a malformed value', () => {
    expect(resolveProjectFromParam('; drop table dcs.documents;', projects)).toBe('')
  })
})

// DCS 1b.04 follow-up. The acceptance criterion "Language defaults to EN" was
// never asserted anywhere: the smoke-test document on scl-dev came out PL,
// which proves the field is changeable, not that it starts on EN.
//
// This is the whole of the form's language default. DocumentCreateForm's only
// remaining say in the matter is `useState(() => defaultLanguageId(languages))`
// — a useState INITIALISER, so it is what the field holds on first render,
// before any user input, which is exactly the claim being made. No jsdom or RTL
// is involved because this repo has neither on purpose (vitest.config.ts, DCS
// 1a.12); the rule was extracted from the component so it could be tested
// directly instead.
describe('defaultLanguageId', () => {
  // The two rows the language dictionary actually holds, in the order the page
  // loads them (getActiveDictionary orders by sort_order, and EN is not first).
  const languages = [
    { id: A, code: 'PL' },
    { id: B, code: 'EN' },
  ]

  it('starts on EN, not on the first row of the dictionary', () => {
    expect(defaultLanguageId(languages)).toBe(B)
  })

  it('picks EN by code, wherever it sits in the list', () => {
    expect(defaultLanguageId([{ id: C, code: 'EN' }, { id: A, code: 'PL' }])).toBe(C)
    expect(defaultLanguageId([{ id: A, code: 'PL' }, { id: C, code: 'EN' }])).toBe(C)
  })

  it('resolves the code named by DEFAULT_LANGUAGE_CODE, not a literal of its own', () => {
    const row = languages.find((l) => l.code === DEFAULT_LANGUAGE_CODE)
    expect(defaultLanguageId(languages)).toBe(row?.id)
  })

  // The fallbacks. Neither is a second default — they keep a required field
  // from starting empty in an environment whose dictionary lost EN.
  it('falls back to the first row when the dictionary has no EN', () => {
    expect(defaultLanguageId([{ id: A, code: 'PL' }, { id: C, code: 'DE' }])).toBe(A)
  })

  it('returns an empty string for an empty dictionary rather than throwing', () => {
    expect(defaultLanguageId([])).toBe('')
  })
})

describe('mapDbError', () => {
  // 23514 is shared by four rules on dcs.documents, so the mapper reads the
  // message, never the SQLSTATE alone. These are the real message texts.
  it('separates the four different 23514s', () => {
    expect(
      mapDbError('23514', 'new row violates check constraint "documents_originator_not_checker"'),
    ).toMatchObject({ error: 'originator_is_checker' })

    expect(
      mapDbError(
        '23514',
        'dcs.documents cannot be created on project 094e130b…: it has no dcs.mdr_settings row, which means DCS does not run this project.',
      ),
    ).toMatchObject({ error: 'no_mdr_settings' })

    expect(
      mapDbError('23514', 'dcs.documents.cpy_doc_number cannot be set on this project: … The CPY track is the client\'s numbering'),
    ).toMatchObject({ error: 'invalid_input' })

    expect(
      mapDbError('23514', 'new row violates check constraint "documents_budget_hours_non_negative"'),
    ).toMatchObject({ error: 'invalid_input' })
  })

  it('does not guess at an unrecognised 23514 — it reports db_error with the raw message', () => {
    expect(mapDbError('23514', 'some future constraint')).toMatchObject({
      error: 'db_error',
      message: 'some future constraint',
    })
  })

  it('maps the RLS refusal to a message naming both ways in', () => {
    const result = mapDbError('42501', 'new row violates row-level security policy')
    expect(result.error).toBe('forbidden')
    expect(result.message).toMatch(/Originator role/)
    expect(result.message).toMatch(/second factor/)
  })

  it('maps the 1b.02 refusal of a supplied number', () => {
    expect(mapDbError('23001', 'scl_doc_number is assigned by the system')).toMatchObject({
      error: 'number_supplied',
    })
  })

  it('separates a CTR-code project mismatch from any other FK violation', () => {
    expect(mapDbError('23503', 'dcs.documents.ctr_code must be a CTR code of the same project')).toMatchObject({
      error: 'ctr_wrong_project',
    })
    expect(mapDbError('23503', 'violates foreign key constraint "documents_originator_id_fkey"')).toMatchObject({
      error: 'unknown_reference',
    })
  })
})

// ---------------------------------------------------------------------------
// DCS 1b.07 — the profile's route guard and setCpyNumber
// ---------------------------------------------------------------------------

describe('isUuid', () => {
  it('accepts a uuid and refuses anything else, so /documents/abc is a 404 and not a 22P02', () => {
    expect(isUuid(A)).toBe(true)
    expect(isUuid('abc')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(`${A}0`)).toBe(false)
  })
})

describe('parseSetCpyNumberInput', () => {
  it('trims the number and keeps the document id', () => {
    expect(parseSetCpyNumberInput({ documentId: A, cpyNumber: '  CPY-0042 ' })).toEqual({
      ok: true,
      data: { documentId: A, cpyNumber: 'CPY-0042' },
    })
  })

  // Clearing the number is a legal write (the trigger still restricts it to the DC).
  it('turns an empty, blank or missing number into null', () => {
    for (const cpyNumber of ['', '   ', null, undefined]) {
      expect(parseSetCpyNumberInput({ documentId: A, cpyNumber })).toEqual({
        ok: true,
        data: { documentId: A, cpyNumber: null },
      })
    }
  })

  it('invents no format rule: any non-empty text is passed through as the client wrote it', () => {
    const parsed = parseSetCpyNumberInput({ documentId: A, cpyNumber: 'PL/2026/RA-0012 rev.B' })
    expect(parsed).toEqual({ ok: true, data: { documentId: A, cpyNumber: 'PL/2026/RA-0012 rev.B' } })
  })

  it('refuses a payload that is not the right shape', () => {
    expect(parseSetCpyNumberInput(null).ok).toBe(false)
    expect(parseSetCpyNumberInput({ cpyNumber: 'x' }).ok).toBe(false)
    expect(parseSetCpyNumberInput({ documentId: 'nope', cpyNumber: 'x' }).ok).toBe(false)
    expect(parseSetCpyNumberInput({ documentId: A, cpyNumber: 42 }).ok).toBe(false)
  })

  // The action may touch ONE column. Nothing else on the payload may reach it.
  it('returns only documentId and cpyNumber, dropping anything else a caller adds', () => {
    const parsed = parseSetCpyNumberInput({ documentId: A, cpyNumber: 'x', scl_doc_number: 'FORGED', title: 'T' })
    expect(parsed.ok && Object.keys(parsed.data).sort()).toEqual(['cpyNumber', 'documentId'])
  })
})

describe('mapCpyDbError', () => {
  it('words the aal1 refusal and the non-DC refusal differently, because the fix differs', () => {
    const aal1 = mapCpyDbError('42501', 'dcs.documents.cpy_doc_number may be changed only in a session with a verified second factor (aal2). Current assurance level: aal1.')
    const notDc = mapCpyDbError('42501', 'dcs.documents.cpy_doc_number may be changed only by the Document Controller of this project (dcs.project_roles role \'dc\'). Caller: x.')
    expect(aal1).toMatchObject({ ok: false, error: 'forbidden' })
    expect(notDc).toMatchObject({ ok: false, error: 'forbidden' })
    expect(aal1.message).toMatch(/second factor/)
    expect(notDc.message).toMatch(/Document Controller/)
    expect(notDc.message).not.toBe(aal1.message)
  })

  it('does not reuse the create-form wording for 42501', () => {
    expect(mapCpyDbError('42501', 'x').message).not.toMatch(/create a document/)
  })

  it('maps the no-CPY-track trigger and the unique constraint', () => {
    expect(mapCpyDbError('23514', 'dcs.documents.cpy_doc_number cannot be set on this project: ... The CPY track is the client\'s numbering')).toMatchObject({
      error: 'invalid_input',
    })
    expect(mapCpyDbError('23505', 'duplicate key value violates unique constraint')).toMatchObject({
      error: 'duplicate_number',
    })
  })

  it('leaves an unrecognised error as db_error with the raw message attached', () => {
    expect(mapCpyDbError('XX000', 'boom')).toEqual({ ok: false, error: 'db_error', message: 'boom' })
    expect(mapCpyDbError('23514', 'something else')).toEqual({ ok: false, error: 'db_error', message: 'something else' })
  })
})

// A fake of just the chain setCpyNumber uses: auth.getUser() and
// schema().from().update().eq().select().maybeSingle().
function cpyClient(result: { data: unknown; error: { code?: string; message: string } | null }, user: object | null = { id: A }) {
  const update = vi.fn()
  const chain = {
    update: (payload: unknown) => {
      update(payload)
      return chain
    },
    eq: () => chain,
    select: () => chain,
    maybeSingle: () => Promise.resolve(result),
  }
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    schema: () => ({ from: () => chain }),
  }
  return { client: client as unknown as SupabaseClient<Database>, update }
}

describe('setCpyNumber', () => {
  it('writes ONE column, cpy_doc_number, and returns what was stored', async () => {
    const { client, update } = cpyClient({ data: { id: B, cpy_doc_number: 'CPY-0042' }, error: null })
    const result = await setCpyNumber(client, { documentId: B, cpyNumber: ' CPY-0042 ', scl_doc_number: 'FORGED' })
    expect(update).toHaveBeenCalledWith({ cpy_doc_number: 'CPY-0042' })
    expect(result).toEqual({ ok: true, data: { documentId: B, cpyNumber: 'CPY-0042' } })
  })

  it('sends null to clear the number', async () => {
    const { client, update } = cpyClient({ data: { id: B, cpy_doc_number: null }, error: null })
    await setCpyNumber(client, { documentId: B, cpyNumber: '' })
    expect(update).toHaveBeenCalledWith({ cpy_doc_number: null })
  })

  // RED PROOF (app half of acceptance 3): an UPDATE that RLS filters away is a
  // success with zero rows in PostgREST — a plain member, or a DC at aal1.
  // It must come back as a refusal, never as a silent "saved".
  it('reports a filtered-away update (zero rows) as forbidden, not as success', async () => {
    const { client } = cpyClient({ data: null, error: null })
    const result = await setCpyNumber(client, { documentId: B, cpyNumber: 'CPY-1' })
    expect(result).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('translates the trigger refusal an ORIG member gets', async () => {
    const { client } = cpyClient({
      data: null,
      error: { code: '42501', message: 'dcs.documents.cpy_doc_number may be changed only by the Document Controller of this project' },
    })
    expect(await setCpyNumber(client, { documentId: B, cpyNumber: 'CPY-1' })).toMatchObject({
      ok: false,
      error: 'forbidden',
    })
  })

  it('refuses without a session and without touching the table', async () => {
    const { client, update } = cpyClient({ data: null, error: null }, null)
    expect(await setCpyNumber(client, { documentId: B, cpyNumber: 'CPY-1' })).toMatchObject({
      ok: false,
      error: 'unauthenticated',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a malformed payload before any write', async () => {
    const { client, update } = cpyClient({ data: null, error: null })
    expect(await setCpyNumber(client, { documentId: 'nope' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DCS 1b.11: manual status change and Void
// ---------------------------------------------------------------------------

describe('DOCUMENT_STATUS_CODES', () => {
  it('excludes VOID (a separate action) and SUPERSEDED (revision-only)', () => {
    expect(DOCUMENT_STATUS_CODES).not.toContain('VOID')
    expect(DOCUMENT_STATUS_CODES).not.toContain('SUPERSEDED')
    expect(DOCUMENT_STATUS_CODES).toEqual(['NOT_STARTED', 'STARTED', 'IDC', 'IFR', 'RETCOM', 'IFC', 'IFI', 'IFB'])
  })
})

describe('documentStatusOptions', () => {
  it('keeps only the eight plain statuses, in dictionary order', () => {
    const all = [
      { code: 'NOT_STARTED' },
      { code: 'STARTED' },
      { code: 'IDC' },
      { code: 'IFR' },
      { code: 'RETCOM' },
      { code: 'IFC' },
      { code: 'IFI' },
      { code: 'IFB' },
      { code: 'VOID' },
      { code: 'SUPERSEDED' },
    ]
    expect(documentStatusOptions(all).map((s) => s.code)).toEqual(['NOT_STARTED', 'STARTED', 'IDC', 'IFR', 'RETCOM', 'IFC', 'IFI', 'IFB'])
  })
})

describe('documentStatusAccess', () => {
  it('is enabled for a DC at aal2', () => {
    expect(documentStatusAccess({ isAdmin: false, isDc: true, aal2: true, isVoid: false })).toEqual({ mode: 'enabled' })
  })
  it('is enabled for an admin at aal2', () => {
    expect(documentStatusAccess({ isAdmin: true, isDc: false, aal2: true, isVoid: false })).toEqual({ mode: 'enabled' })
  })
  it('asks a DC without aal2 to verify a second factor', () => {
    expect(documentStatusAccess({ isAdmin: false, isDc: true, aal2: false, isVoid: false })).toMatchObject({
      mode: 'disabled',
      reason: 'needs_second_factor',
    })
  })
  it('refuses a plain member outright', () => {
    expect(documentStatusAccess({ isAdmin: false, isDc: false, aal2: true, isVoid: false })).toMatchObject({
      mode: 'disabled',
      reason: 'not_allowed',
    })
  })
  it('while Void: a DC at aal2 is STILL refused — only an admin may leave Void', () => {
    expect(documentStatusAccess({ isAdmin: false, isDc: true, aal2: true, isVoid: true })).toMatchObject({
      mode: 'disabled',
      reason: 'void_admin_only',
    })
  })
  it('while Void: an admin at aal2 is enabled', () => {
    expect(documentStatusAccess({ isAdmin: true, isDc: false, aal2: true, isVoid: true })).toEqual({ mode: 'enabled' })
  })
  it('while Void: an admin without aal2 is still refused', () => {
    expect(documentStatusAccess({ isAdmin: true, isDc: false, aal2: false, isVoid: true })).toMatchObject({
      mode: 'disabled',
      reason: 'void_admin_only',
    })
  })
})

describe('voidDocumentAccess', () => {
  it('is enabled for a DC at aal2, not-yet-Void', () => {
    expect(voidDocumentAccess({ isDc: true, aal2: true, isVoid: false })).toEqual({ mode: 'enabled' })
  })
  it('asks a DC without aal2 to verify a second factor', () => {
    expect(voidDocumentAccess({ isDc: true, aal2: false, isVoid: false })).toMatchObject({ mode: 'disabled', reason: 'needs_second_factor' })
  })
  it('refuses a non-DC outright — admin included, since admin cannot write void_reason', () => {
    expect(voidDocumentAccess({ isDc: false, aal2: true, isVoid: false })).toMatchObject({ mode: 'disabled', reason: 'not_allowed' })
  })
  it('is disabled once already Void, even for the DC who voided it', () => {
    expect(voidDocumentAccess({ isDc: true, aal2: true, isVoid: true })).toMatchObject({ mode: 'disabled', reason: 'already_void' })
  })
})

describe('parseSetDocumentStatusInput', () => {
  it('accepts a valid pair', () => {
    expect(parseSetDocumentStatusInput({ documentId: A, statusCode: 'IFR' })).toEqual({
      ok: true,
      data: { documentId: A, statusCode: 'IFR' },
    })
  })
  it('rejects VOID — it is not one of the plain statuses', () => {
    expect(parseSetDocumentStatusInput({ documentId: A, statusCode: 'VOID' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
  it('rejects SUPERSEDED', () => {
    expect(parseSetDocumentStatusInput({ documentId: A, statusCode: 'SUPERSEDED' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
  it('rejects a made-up code', () => {
    expect(parseSetDocumentStatusInput({ documentId: A, statusCode: 'NOPE' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
  it('rejects a non-uuid documentId', () => {
    expect(parseSetDocumentStatusInput({ documentId: 'nope', statusCode: 'IFR' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})

describe('parseVoidDocumentInput', () => {
  it('accepts and trims a real reason', () => {
    expect(parseVoidDocumentInput({ documentId: A, reason: '  Client cancelled the scope  ' })).toEqual({
      ok: true,
      data: { documentId: A, reason: 'Client cancelled the scope' },
    })
  })
  it('rejects a missing reason', () => {
    expect(parseVoidDocumentInput({ documentId: A })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
  it('rejects a blank (whitespace-only) reason', () => {
    expect(parseVoidDocumentInput({ documentId: A, reason: '   ' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})

describe('mapDocumentStatusDbError', () => {
  it('42501 with "verified second factor" asks for aal2', () => {
    expect(mapDocumentStatusDbError('42501', 'needs a verified second factor')).toMatchObject({ error: 'forbidden' })
  })
  it('other 42501 names who may act', () => {
    expect(mapDocumentStatusDbError('42501', 'wrong caller')).toMatchObject({ error: 'forbidden' })
  })
  it('23001 (leaving Void refused) is worded as forbidden, admin-only', () => {
    expect(mapDocumentStatusDbError('23001', 'is Void')).toMatchObject({ error: 'forbidden' })
  })
  it('falls through to db_error with the raw message', () => {
    expect(mapDocumentStatusDbError('XX000', 'boom')).toEqual({ ok: false, error: 'db_error', message: 'boom' })
  })
})

// A stand-in for the typed client: dictionary lookup by code, then update.
function statusClient(opts: {
  user?: { id: string } | null
  status?: { id: string } | null
  update?: { data: unknown; error: { code?: string; message: string } | null }
}) {
  const update = vi.fn()
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: opts.status === undefined ? { id: 'status-id' } : opts.status, error: null }),
    update: (payload: unknown) => {
      update(payload)
      return chain
    },
  }
  const updateChain = {
    select: () => updateChain,
    eq: () => updateChain,
    maybeSingle: async () => opts.update ?? { data: { id: 'doc-1', workflow_status: { code: 'IFR' }, void_reason: 'reason' }, error: null },
    update: (payload: unknown) => {
      update(payload)
      return updateChain
    },
  }
  let calls = 0
  const from = () => {
    calls += 1
    // First call: the dictionary lookup. Second: the document update.
    return calls === 1 ? chain : updateChain
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: 'u1' } : opts.user } }) },
    schema: () => ({ from }),
  } as unknown as SupabaseClient<Database>
  return { client, update }
}

describe('setDocumentStatus', () => {
  it('writes ONE column, workflow_status_id, resolved from the code', async () => {
    const { client, update } = statusClient({ status: { id: 'status-IFR' } })
    const result = await setDocumentStatus(client, { documentId: A, statusCode: 'IFR' })
    expect(update).toHaveBeenCalledWith({ workflow_status_id: 'status-IFR' })
    expect(result.ok).toBe(true)
  })

  it('reports a filtered-away update (zero rows) as forbidden, not as success', async () => {
    const { client } = statusClient({ update: { data: null, error: null } })
    expect(await setDocumentStatus(client, { documentId: A, statusCode: 'IFR' })).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('refuses without a session and without touching the table', async () => {
    const { client, update } = statusClient({ user: null })
    expect(await setDocumentStatus(client, { documentId: A, statusCode: 'IFR' })).toMatchObject({ ok: false, error: 'unauthenticated' })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a malformed payload before any write', async () => {
    const { client, update } = statusClient({})
    expect(await setDocumentStatus(client, { documentId: A, statusCode: 'VOID' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(update).not.toHaveBeenCalled()
  })
})

describe('voidDocument', () => {
  it('writes BOTH workflow_status_id and void_reason in the same update', async () => {
    const { client, update } = statusClient({ status: { id: 'status-VOID' } })
    const result = await voidDocument(client, { documentId: A, reason: '  Client cancelled the scope  ' })
    expect(update).toHaveBeenCalledWith({ workflow_status_id: 'status-VOID', void_reason: 'Client cancelled the scope' })
    expect(result.ok).toBe(true)
  })

  it('refuses a blank reason before any write', async () => {
    const { client, update } = statusClient({})
    expect(await voidDocument(client, { documentId: A, reason: '   ' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a filtered-away update as forbidden', async () => {
    const { client } = statusClient({ update: { data: null, error: null } })
    expect(await voidDocument(client, { documentId: A, reason: 'Client cancelled the scope' })).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('refuses without a session and without touching the table', async () => {
    const { client, update } = statusClient({ user: null })
    expect(await voidDocument(client, { documentId: A, reason: 'Client cancelled the scope' })).toMatchObject({
      ok: false,
      error: 'unauthenticated',
    })
    expect(update).not.toHaveBeenCalled()
  })
})
