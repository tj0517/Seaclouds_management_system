// DCS 1b.08. Unit tests for the decisions in lib/revisions.ts — the parts that
// run before, or instead of, a database. The rules themselves are proven
// against Postgres in supabase/tests/scl_revision_generator.test.sql and
// revision_promotion.test.sql; these cover what the user is told and what the
// server action is willing to send.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  REVISION_STEP_CODES,
  cpyRevisionField,
  createRevision,
  defaultRevisionStepId,
  isValidDateString,
  lockRevision,
  lockRevisionAccess,
  mapLockDbError,
  mapRevisionDbError,
  newRevisionAccess,
  parseCreateRevisionInput,
  parseLockRevisionInput,
  proposeRevisionCode,
  revisionStepOptions,
  sclCodeField,
  todayLocalIso,
  toRevisionRows,
} from './revisions'

const DOC = '11111111-1111-4111-8111-111111111111'
const STEP = '22222222-2222-4222-8222-222222222222'
const ACC = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const USER = '55555555-5555-4555-8555-555555555555'

const valid = { documentId: DOC, stepId: STEP, revisionDate: '2026-09-20' }

describe('revisionStepOptions', () => {
  const dictionary = ['IDC', 'IFR', 'RETCOM', 'IFC', 'IFI', 'IFB', 'XYZ'].map((code) => ({ id: `id-${code}`, code }))

  it('offers the five steps that have a series, in the dictionary order', () => {
    expect(revisionStepOptions(dictionary).map((step) => step.code)).toEqual(['IDC', 'IFR', 'IFC', 'IFI', 'IFB'])
  })

  // RETCOM has no series on purpose (docs/adr/0015): the database refuses it, and
  // the dialog must not offer a choice that can never be saved.
  it('leaves RETCOM out — it has no SCL series', () => {
    expect(revisionStepOptions(dictionary).some((step) => step.code === 'RETCOM')).toBe(false)
  })

  it('leaves out a step a DC added to the dictionary, which has no series either', () => {
    expect(revisionStepOptions(dictionary).some((step) => step.code === 'XYZ')).toBe(false)
  })

  it('is exactly the steps dcs.revision_series_pattern knows', () => {
    expect([...REVISION_STEP_CODES]).toEqual(['IDC', 'IFR', 'IFC', 'IFI', 'IFB'])
  })
})

describe('defaultRevisionStepId', () => {
  const options = ['IDC', 'IFR', 'IFC'].map((code) => ({ id: `id-${code}`, code }))

  it('starts on the current revision’s own step, so Create issues the next code of the same series', () => {
    expect(defaultRevisionStepId(options, 'IFR')).toBe('id-IFR')
  })
  it('starts on the first step when the document has no revision', () => {
    expect(defaultRevisionStepId(options, null)).toBe('id-IDC')
    expect(defaultRevisionStepId(options, undefined)).toBe('id-IDC')
  })
  it('falls back to the first step when the current step is one the dialog does not offer', () => {
    expect(defaultRevisionStepId(options, 'RETCOM')).toBe('id-IDC')
  })
  it('is empty rather than throwing when there are no steps', () => {
    expect(defaultRevisionStepId([], 'IDC')).toBe('')
  })
})

describe('newRevisionAccess', () => {
  const reader = { isAdmin: false, isOrig: false, isDc: false, aal2: false, documentStatusCode: 'STARTED' }

  it('is live for an Originator, with no second factor', () => {
    expect(newRevisionAccess({ ...reader, isOrig: true })).toEqual({ mode: 'enabled' })
  })
  it('is live for the DC in an aal2 session', () => {
    expect(newRevisionAccess({ ...reader, isDc: true, aal2: true })).toEqual({ mode: 'enabled' })
  })
  it('is live for an admin', () => {
    expect(newRevisionAccess({ ...reader, isAdmin: true })).toEqual({ mode: 'enabled' })
  })

  // Mirrors "Doc controllers insert revisions" (dc AND aal2): a DC at aal1 who is
  // not also an ORIG is told what to fix, not that the button is not theirs.
  it('tells a DC without a second factor to verify it', () => {
    expect(newRevisionAccess({ ...reader, isDc: true })).toMatchObject({ mode: 'disabled', reason: 'needs_second_factor' })
  })
  it('does NOT ask a DC who is also an Originator for a second factor — the Originator policy needs none', () => {
    expect(newRevisionAccess({ ...reader, isDc: true, isOrig: true })).toEqual({ mode: 'enabled' })
  })
  it('is off for a plain member, a viewer or an outsider', () => {
    expect(newRevisionAccess(reader)).toMatchObject({ mode: 'disabled', reason: 'not_allowed' })
  })

  // RED PROOF (app half of acceptance 3): Void wins over role — "this document
  // takes no revisions" is the true reason for everyone, admin included.
  it('is off on a Void document for every role, and says why', () => {
    const void_ = { ...reader, documentStatusCode: 'VOID' }
    for (const who of [{ isOrig: true }, { isDc: true, aal2: true }, { isAdmin: true }, {}]) {
      const access = newRevisionAccess({ ...void_, ...who })
      expect(access).toMatchObject({ mode: 'disabled', reason: 'void' })
      expect(access.mode === 'disabled' && access.hint).toMatch(/Void/)
    }
  })
})

describe('sclCodeField', () => {
  it('is editable only for the project’s DC in an aal2 session — the caller the trigger accepts a code from', () => {
    expect(sclCodeField({ isProjectDc: true, aal2: true })).toEqual({ mode: 'editable' })
  })
  it('is read-only for a DC without the second factor, and says what to fix', () => {
    const field = sclCodeField({ isProjectDc: true, aal2: false })
    expect(field.mode).toBe('assigned')
    expect(field.mode === 'assigned' && field.hint).toMatch(/second factor/)
  })
  it('is read-only for an Originator, including one at aal2', () => {
    expect(sclCodeField({ isProjectDc: false, aal2: true }).mode).toBe('assigned')
    expect(sclCodeField({ isProjectDc: false, aal2: false }).mode).toBe('assigned')
  })
})

describe('cpyRevisionField', () => {
  it('shows the field only to the DC of a project that runs a CPY track, with a second factor', () => {
    expect(cpyRevisionField({ mode: 'editable' })).toEqual({ mode: 'editable' })
  })
  it('shows nothing and says nothing where the project runs no CPY track', () => {
    expect(cpyRevisionField({ mode: 'numbering_off' })).toEqual({ mode: 'hidden', hint: null })
  })
  // Decision 6: an Originator who typed a CPY revision would be refused by the
  // 1b.03 trigger (42501), so the field is not offered — the sentence says who sets it.
  it('hides the field from everyone else on a CPY project and says who sets it', () => {
    for (const reason of ['not_dc', 'needs_second_factor'] as const) {
      const field = cpyRevisionField({ mode: 'read_only', reason })
      expect(field.mode).toBe('hidden')
      expect(field.mode === 'hidden' && field.hint).toMatch(/Document Controller/)
    }
  })
})

describe('isValidDateString / todayLocalIso', () => {
  it('accepts a real calendar date', () => {
    expect(isValidDateString('2026-09-20')).toBe(true)
    expect(isValidDateString('2028-02-29')).toBe(true)
  })
  it('rejects an impossible date, a wrong shape and the empty string', () => {
    expect(isValidDateString('2026-02-30')).toBe(false)
    expect(isValidDateString('2027-02-29')).toBe(false)
    expect(isValidDateString('20-09-2026')).toBe(false)
    expect(isValidDateString('2026-9-2')).toBe(false)
    expect(isValidDateString('')).toBe(false)
  })
  it('writes today in the reader’s own calendar, zero-padded', () => {
    expect(todayLocalIso(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(todayLocalIso(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('parseCreateRevisionInput', () => {
  it('accepts the minimum: a document, a step and a date', () => {
    expect(parseCreateRevisionInput(valid)).toEqual({
      ok: true,
      data: {
        documentId: DOC,
        stepId: STEP,
        sclRevision: null,
        cpyRevision: null,
        revisionDate: '2026-09-20',
        reasonForIssue: null,
        acceptanceCodeId: null,
      },
    })
  })

  it('trims text and turns an empty string into null', () => {
    const result = parseCreateRevisionInput({
      ...valid,
      sclRevision: '  ',
      cpyRevision: ' CLIENT-7 ',
      reasonForIssue: '  For review  ',
      acceptanceCodeId: '',
    })
    expect(result).toMatchObject({
      ok: true,
      data: { sclRevision: null, cpyRevision: 'CLIENT-7', reasonForIssue: 'For review', acceptanceCodeId: null },
    })
  })

  it('carries a code the DC typed, trimmed', () => {
    expect(parseCreateRevisionInput({ ...valid, sclRevision: ' C ' })).toMatchObject({ ok: true, data: { sclRevision: 'C' } })
  })

  // The date is required by owner's decision: a blank issue date is a blank cell in dcs.v_mdr.
  it('requires a real revision date', () => {
    expect(parseCreateRevisionInput({ documentId: DOC, stepId: STEP })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseCreateRevisionInput({ ...valid, revisionDate: '' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseCreateRevisionInput({ ...valid, revisionDate: '2026-02-30' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it('requires uuids for the document, the step and the acceptance code', () => {
    expect(parseCreateRevisionInput({ ...valid, documentId: 'nope' })).toMatchObject({ ok: false })
    expect(parseCreateRevisionInput({ ...valid, stepId: 'nope' })).toMatchObject({ ok: false })
    expect(parseCreateRevisionInput({ ...valid, acceptanceCodeId: 'nope' })).toMatchObject({ ok: false })
    expect(parseCreateRevisionInput({ ...valid, acceptanceCodeId: ACC })).toMatchObject({ ok: true })
  })

  it('refuses a payload that is not an object or carries a non-string text field', () => {
    expect(parseCreateRevisionInput(null)).toMatchObject({ ok: false })
    expect(parseCreateRevisionInput('x')).toMatchObject({ ok: false })
    expect(parseCreateRevisionInput({ ...valid, reasonForIssue: 5 })).toMatchObject({ ok: false })
    expect(parseCreateRevisionInput({ ...valid, cpyRevision: {} })).toMatchObject({ ok: false })
  })

  // The payload is built field by field: nothing the client adds survives.
  it('drops every key it does not know — status, author, current pointer, the snake_case code', () => {
    const result = parseCreateRevisionInput({
      ...valid,
      status_id: 'forged',
      created_by: 'forged',
      current_revision_id: 'forged',
      scl_revision: 'FORGED',
    })
    expect(result.ok).toBe(true)
    expect(result.ok && Object.keys(result.data).sort()).toEqual(
      ['acceptanceCodeId', 'cpyRevision', 'documentId', 'reasonForIssue', 'revisionDate', 'sclRevision', 'stepId'].sort(),
    )
    expect(result.ok && result.data.sclRevision).toBeNull()
  })
})

// The messages below are the ones the triggers really write — copied from
// supabase/migrations/20260920134700_scl_revision_generator.sql and the 1b.03
// enforce_dc_only_numbering — so a reworded trigger fails here instead of
// silently turning into a generic "forbidden".
describe('mapRevisionDbError', () => {
  const notDc =
    "dcs.revisions.scl_revision is assigned by the system; a value may be supplied on INSERT only by the Document Controller of this project (dcs.project_roles role 'dc'). Leave it NULL and the code is generated from the step (got 'Z'). Caller: abc."
  const aal1 =
    'dcs.revisions.scl_revision may be supplied on INSERT only in a session with a verified second factor (aal2). Current assurance level: aal1.'

  it('tells an Originator that only the DC chooses the code', () => {
    expect(mapRevisionDbError('42501', notDc)).toMatchObject({ ok: false, error: 'code_not_allowed' })
  })
  it('tells a DC without the second factor to verify it, in different words', () => {
    const result = mapRevisionDbError('42501', aal1)
    expect(result).toMatchObject({ ok: false, error: 'forbidden' })
    expect(result.ok === false && result.message).toMatch(/second factor/)
  })
  it('tells the two CPY refusals apart from the code refusals', () => {
    const cpyNotDc = 'dcs.revisions.cpy_revision may be set only by the Document Controller of this project (dcs.project_roles role \'dc\'). Caller: abc.'
    const cpyAal =
      'dcs.revisions.cpy_revision may be set only in a session with a verified second factor (aal2). Current assurance level: aal1.'
    expect(mapRevisionDbError('42501', cpyNotDc)).toMatchObject({ error: 'forbidden' })
    expect(mapRevisionDbError('42501', cpyNotDc).message).toMatch(/client \(CPY\) revision/)
    expect(mapRevisionDbError('42501', cpyAal).message).toMatch(/second factor/)
  })
  it('words a bare RLS refusal as “you cannot create a revision”', () => {
    const result = mapRevisionDbError('42501', 'new row violates row-level security policy for table "revisions"')
    expect(result).toMatchObject({ ok: false, error: 'forbidden' })
    expect(result.ok === false && result.message).toMatch(/Originator/)
  })
  it('names a Void document', () => {
    expect(
      mapRevisionDbError('23514', 'dcs.revisions: document abc is Void and takes no new revisions. A Void document keeps its number and its history; to continue the work, create a new document.'),
    ).toMatchObject({ error: 'void_document' })
  })
  it('explains RETCOM instead of echoing the trigger', () => {
    const result = mapRevisionDbError(
      '23514',
      'dcs.revisions: a revision on step RETCOM cannot be created. RETCOM has no SCL revision series — it is the client returning a document',
    )
    expect(result).toMatchObject({ error: 'no_series' })
    expect(result.ok === false && result.message).toMatch(/client returning a document/)
  })
  it('passes a wrong-shape code through with the database’s own sentence', () => {
    const message = "dcs.revisions.scl_revision 'ZZ' is not a valid code for step IDC. IDC codes are one capital letter (A, B …)."
    expect(mapRevisionDbError('23514', message)).toEqual({ ok: false, error: 'code_shape', message })
  })
  it('recognises the CPY-track refusal', () => {
    expect(mapRevisionDbError('23514', 'dcs.revisions.cpy_revision cannot be set on this project: The CPY track is the client’s numbering')).toMatchObject({
      error: 'cpy_off',
    })
  })
  it('turns a UNIQUE clash into “someone just created one”', () => {
    expect(mapRevisionDbError('23505', 'duplicate key value violates unique constraint "revisions_document_id_scl_revision_key"')).toMatchObject({
      error: 'duplicate_code',
    })
  })
  it('passes a series that ran out through with the database’s sentence', () => {
    const message = 'dcs.next_revision_code: the IDC series on document abc has reached Z.'
    expect(mapRevisionDbError('22003', message)).toEqual({ ok: false, error: 'series_exhausted', message })
  })
  it('maps the two 22023 refusals of the proposal function', () => {
    expect(mapRevisionDbError('22023', 'dcs.next_revision_code: step RETCOM has no SCL revision series.')).toMatchObject({ error: 'no_series' })
    expect(mapRevisionDbError('22023', 'dcs.next_revision_code: no dcs.documents row with id abc is visible to the caller.')).toMatchObject({
      error: 'not_found',
    })
  })
  it('ends in db_error with the raw message rather than guessing', () => {
    expect(mapRevisionDbError('XX000', 'boom')).toEqual({ ok: false, error: 'db_error', message: 'boom' })
    expect(mapRevisionDbError('23514', 'some rule nobody has met')).toMatchObject({ error: 'db_error', message: 'some rule nobody has met' })
  })
})

// A stand-in for the typed client that answers by table and records the insert.
function fakeClient(opts: {
  user?: { id: string } | null
  document?: { id: string; project_id: string } | null
  step?: { code: string } | null
  status?: { id: string } | null
  insert?: { data: { id: string; scl_revision: string } | null; error: { code?: string; message: string } | null }
  rpc?: { data: unknown; error: { code?: string; message: string } | null }
}) {
  const inserts: unknown[] = []
  const statusLookups: Record<string, unknown>[] = []
  const rpc = vi.fn(async () => opts.rpc ?? { data: 'A', error: null })
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        filters[key] = value
        return chain
      },
      maybeSingle: async () => {
        if (table === 'documents') return { data: opts.document === undefined ? { id: DOC, project_id: PROJECT } : opts.document, error: null }
        if (filters.dict_type === 'workflow_step') return { data: opts.step === undefined ? { code: 'IFR' } : opts.step, error: null }
        statusLookups.push({ ...filters })
        return { data: opts.status === undefined ? { id: 'status-IFR' } : opts.status, error: null }
      },
      insert: (row: unknown) => {
        inserts.push(row)
        return { select: () => ({ single: async () => opts.insert ?? { data: { id: 'rev-1', scl_revision: '00' }, error: null } }) }
      },
    }
    return chain
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: USER } : opts.user } }) },
    schema: () => ({ from, rpc }),
  } as unknown as SupabaseClient<Database>
  return { client, inserts, rpc, statusLookups }
}

describe('createRevision', () => {
  it('leaves scl_revision OUT of the insert when the DC did not type one — the database assigns it', async () => {
    const { client, inserts } = fakeClient({})
    const result = await createRevision(client, { ...valid, reasonForIssue: 'For review', acceptanceCodeId: ACC })
    expect(result).toEqual({ ok: true, data: { id: 'rev-1', sclRevision: '00' } })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).not.toHaveProperty('scl_revision')
  })

  it('sends the code only when the DC typed one', async () => {
    const { client, inserts } = fakeClient({})
    await createRevision(client, { ...valid, sclRevision: '05' })
    expect(inserts[0]).toMatchObject({ scl_revision: '05' })
  })

  it('names every column it sets and takes status, author and project from the server, not the payload', async () => {
    const { client, inserts } = fakeClient({})
    await createRevision(client, {
      ...valid,
      cpyRevision: 'CLIENT-7',
      status_id: 'forged',
      created_by: 'forged',
      project_id: 'forged',
    })
    expect(inserts[0]).toEqual({
      document_id: DOC,
      project_id: PROJECT,
      step_id: STEP,
      status_id: 'status-IFR',
      revision_date: '2026-09-20',
      reason_for_issue: null,
      acceptance_code_id: null,
      cpy_revision: 'CLIENT-7',
      created_by: USER,
    })
  })

  // The owner's decision 7: the status is the workflow_status whose CODE equals the step's.
  it('resolves the revision status from the step’s own code', async () => {
    const { client, statusLookups, inserts } = fakeClient({ step: { code: 'IFC' }, status: { id: 'status-IFC' } })
    const result = await createRevision(client, valid)
    expect(result.ok).toBe(true)
    // looked up by CODE, never by an id baked into the app: dictionary uuids differ per environment
    expect(statusLookups).toEqual([{ dict_type: 'workflow_status', code: 'IFC' }])
    expect(inserts[0]).toMatchObject({ status_id: 'status-IFC' })
  })

  it('refuses without a session and without touching the table', async () => {
    const { client, inserts } = fakeClient({ user: null })
    expect(await createRevision(client, valid)).toMatchObject({ ok: false, error: 'unauthenticated' })
    expect(inserts).toHaveLength(0)
  })

  it('refuses a malformed payload before any write', async () => {
    const { client, inserts } = fakeClient({})
    expect(await createRevision(client, { documentId: 'nope' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(inserts).toHaveLength(0)
  })

  it('reports a document RLS hides as not found, the same answer as one that does not exist', async () => {
    const { client, inserts } = fakeClient({ document: null })
    expect(await createRevision(client, valid)).toMatchObject({ ok: false, error: 'not_found' })
    expect(inserts).toHaveLength(0)
  })

  it('refuses a step id that is not a workflow step', async () => {
    const { client, inserts } = fakeClient({ step: null })
    expect(await createRevision(client, valid)).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(inserts).toHaveLength(0)
  })

  it('translates what Postgres said about the insert', async () => {
    const { client } = fakeClient({
      insert: { data: null, error: { code: '23514', message: 'dcs.revisions: document abc is Void and takes no new revisions.' } },
    })
    expect(await createRevision(client, valid)).toMatchObject({ ok: false, error: 'void_document' })
  })
})

describe('proposeRevisionCode', () => {
  it('returns the code the database proposes', async () => {
    const { client, rpc } = fakeClient({ rpc: { data: 'C', error: null } })
    expect(await proposeRevisionCode(client, { documentId: DOC, stepId: STEP })).toEqual({ ok: true, data: { code: 'C' } })
    expect(rpc).toHaveBeenCalledWith('next_revision_code', { p_document_id: DOC, p_step_id: STEP })
  })
  it('refuses without a session and a malformed payload before calling the database', async () => {
    const anon = fakeClient({ user: null })
    expect(await proposeRevisionCode(anon.client, { documentId: DOC, stepId: STEP })).toMatchObject({ error: 'unauthenticated' })
    const bad = fakeClient({})
    expect(await proposeRevisionCode(bad.client, { documentId: 'x', stepId: STEP })).toMatchObject({ error: 'invalid_input' })
    expect(await proposeRevisionCode(bad.client, { documentId: DOC })).toMatchObject({ error: 'invalid_input' })
    expect(bad.rpc).not.toHaveBeenCalled()
  })
  it('turns a database refusal into a typed error', async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { code: '22023', message: 'dcs.next_revision_code: step RETCOM has no SCL revision series.' } } })
    expect(await proposeRevisionCode(client, { documentId: DOC, stepId: STEP })).toMatchObject({ ok: false, error: 'no_series' })
  })
})

describe('toRevisionRows', () => {
  const revision = {
    id: 'r2',
    document_id: DOC,
    scl_revision: '00',
    cpy_revision: null,
    reason_for_issue: null,
    revision_date: '2026-09-20',
    created_at: '2026-09-20T10:00:00Z',
    created_by: USER,
    locked_at: null as string | null,
    step: { code: 'IFR', label: 'Issued for Review' },
    status: { code: 'IFR', label: 'IFR' },
    acceptance: null,
    files: [] as never[],
  }
  const older = {
    ...revision,
    id: 'r1',
    scl_revision: 'A',
    cpy_revision: 'CLIENT-1',
    reason_for_issue: 'First issue',
    status: { code: 'SUPERSEDED', label: 'Superseded' },
    step: { code: 'IDC', label: 'Internal Discipline Check' },
    acceptance: { code: '1', label: 'Accepted' },
    created_by: null,
  }

  it('renders every cell as a string, degrading a missing value to a dash', () => {
    const [row] = toRevisionRows([revision], 'r2', new Map([[USER, 'Olga Originator']]))
    expect(row).toMatchObject({
      sclRevision: '00',
      cpyRevision: '—',
      step: 'IFR — Issued for Review',
      stepCode: 'IFR',
      reason: '—',
      date: '2026-09-20',
      author: 'Olga Originator',
      acceptanceCode: '—',
      acceptanceCodeShort: '—',
      statusCode: 'IFR',
    })
  })

  it('carries isLocked from locked_at (DCS 1b.10/1b.11 Approve)', () => {
    expect(toRevisionRows([revision], 'r2', new Map())[0].isLocked).toBe(false)
    expect(toRevisionRows([{ ...revision, locked_at: '2026-09-22T00:00:00Z' }], 'r2', new Map())[0].isLocked).toBe(true)
  })

  it('marks the document’s current revision and only that one', () => {
    const rows = toRevisionRows([revision, older], 'r2', new Map())
    expect(rows.map((row) => [row.sclRevision, row.isCurrent])).toEqual([
      ['00', true],
      ['A', false],
    ])
  })

  it('shows SUPERSEDED as a revision status, with its own label', () => {
    const [, row] = toRevisionRows([revision, older], 'r2', new Map())
    expect(row).toMatchObject({
      statusCode: 'SUPERSEDED',
      statusLabel: 'SUPERSEDED — Superseded',
      acceptanceCode: '1 — Accepted',
      acceptanceCodeShort: '1',
      stepCode: 'IDC',
      author: '—',
    })
  })

  it('does not throw on a revision whose dictionary rows RLS hides', () => {
    const [row] = toRevisionRows([{ ...revision, step: null, status: null, acceptance: null }], null, new Map())
    expect(row).toMatchObject({ step: '—', stepCode: '—', statusCode: null, statusLabel: '—', acceptanceCodeShort: '—', isCurrent: false })
  })

  it('lists each revision’s files by display name, and an empty list for none', () => {
    const [row] = toRevisionRows(
      [
        {
          ...revision,
          files: [
            { id: 'f1', file_kind: 'original', file_name: null, original_name: 'report.pdf', storage_path: null, size_bytes: 1536, uploaded_at: null },
          ],
        },
      ],
      null,
      new Map(),
    )
    expect(row.files).toEqual([{ id: 'f1', name: 'report.pdf', originalName: '', kind: 'original', size: '1.5 KB', uploaded: '—' }])
    expect(toRevisionRows([revision], null, new Map())[0].files).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DCS 1b.11 / 1b.10: Approve (locked_at)
// ---------------------------------------------------------------------------

describe('lockRevisionAccess', () => {
  it('is enabled for the DC at aal2 on a final step, not yet locked', () => {
    expect(lockRevisionAccess({ isDc: true, aal2: true, stepCode: 'IFC', isLocked: false })).toEqual({ mode: 'enabled' })
  })
  it('checks "already locked" first, even for the DC at aal2', () => {
    expect(lockRevisionAccess({ isDc: true, aal2: true, stepCode: 'IFC', isLocked: true })).toMatchObject({
      mode: 'disabled',
      reason: 'already_locked',
    })
  })
  it('refuses a non-final step (IDC) even for the DC at aal2', () => {
    expect(lockRevisionAccess({ isDc: true, aal2: true, stepCode: 'IDC', isLocked: false })).toMatchObject({
      mode: 'disabled',
      reason: 'not_final_step',
    })
  })
  it('refuses when there is no current revision at all (stepCode null)', () => {
    expect(lockRevisionAccess({ isDc: true, aal2: true, stepCode: null, isLocked: false })).toMatchObject({
      mode: 'disabled',
      reason: 'not_final_step',
    })
  })
  it('asks a DC without aal2 to verify a second factor', () => {
    expect(lockRevisionAccess({ isDc: true, aal2: false, stepCode: 'IFI', isLocked: false })).toMatchObject({
      mode: 'disabled',
      reason: 'needs_second_factor',
    })
  })
  it('refuses a non-DC outright — no admin escape on this column', () => {
    expect(lockRevisionAccess({ isDc: false, aal2: true, stepCode: 'IFB', isLocked: false })).toMatchObject({
      mode: 'disabled',
      reason: 'not_allowed',
    })
  })
})

describe('parseLockRevisionInput', () => {
  it('accepts a valid revisionId', () => {
    expect(parseLockRevisionInput({ revisionId: DOC })).toEqual({ ok: true, data: { revisionId: DOC } })
  })
  it('rejects a non-uuid revisionId', () => {
    expect(parseLockRevisionInput({ revisionId: 'nope' })).toMatchObject({ ok: false, error: 'invalid_input' })
  })
  it('rejects a missing payload', () => {
    expect(parseLockRevisionInput(null)).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})

describe('mapLockDbError', () => {
  it('42501 with "verified second factor" asks for aal2', () => {
    expect(mapLockDbError('42501', 'needs a verified second factor')).toMatchObject({ error: 'forbidden' })
  })
  it('other 42501 names the DC', () => {
    expect(mapLockDbError('42501', 'wrong caller')).toMatchObject({ error: 'forbidden' })
  })
  it('23514 (not a final step) is worded for the field', () => {
    expect(mapLockDbError('23514', 'can be set only on a final revision')).toMatchObject({ error: 'invalid_input' })
  })
  it('falls through to db_error with the raw message', () => {
    expect(mapLockDbError('XX000', 'boom')).toEqual({ ok: false, error: 'db_error', message: 'boom' })
  })
})

function lockClient(opts: {
  user?: { id: string } | null
  update?: { data: { id: string; locked_at: string | null } | null; error: { code?: string; message: string } | null }
}) {
  const update = vi.fn()
  const chain = {
    update: (payload: unknown) => {
      update(payload)
      return chain
    },
    eq: () => chain,
    select: () => chain,
    maybeSingle: async () => opts.update ?? { data: { id: 'rev-1', locked_at: '2026-09-22T00:00:00.000Z' }, error: null },
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: USER } : opts.user } }) },
    schema: () => ({ from: () => chain }),
  } as unknown as SupabaseClient<Database>
  return { client, update }
}

describe('lockRevision', () => {
  it('writes ONE column, locked_at, computed server-side', async () => {
    const { client, update } = lockClient({})
    const before = Date.now()
    const result = await lockRevision(client, { revisionId: DOC })
    expect(result.ok).toBe(true)
    const call = update.mock.calls[0][0] as { locked_at: string }
    expect(Object.keys(call)).toEqual(['locked_at'])
    expect(new Date(call.locked_at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('reports a filtered-away update (zero rows) as forbidden, not as success', async () => {
    const { client } = lockClient({ update: { data: null, error: null } })
    expect(await lockRevision(client, { revisionId: DOC })).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('refuses without a session and without touching the table', async () => {
    const { client, update } = lockClient({ user: null })
    expect(await lockRevision(client, { revisionId: DOC })).toMatchObject({ ok: false, error: 'unauthenticated' })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a malformed payload before any write', async () => {
    const { client, update } = lockClient({})
    expect(await lockRevision(client, { revisionId: 'nope' })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(update).not.toHaveBeenCalled()
  })
})
