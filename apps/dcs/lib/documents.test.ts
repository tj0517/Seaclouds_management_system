// DCS 1b.04. Unit tests for the decisions in lib/documents.ts — the parts that
// run before any database is involved. The rules themselves are proven against
// Postgres in supabase/tests/documents_originator_not_checker.test.sql and
// supabase/tests/documents_require_mdr_settings.test.sql; these cover the
// app-side duplicates that decide what the user is told.
import { describe, expect, it } from 'vitest'
import {
  budgetHoursFromMeta,
  creatableProjects,
  mapDbError,
  originatorIsChecker,
  parseCreateDocumentInput,
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
