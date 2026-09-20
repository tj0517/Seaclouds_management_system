// DCS 1b.07. Unit tests for the decisions behind the document profile — the
// parts that run before, and instead of, a browser. No jsdom by design
// (vitest.config.ts, 1a.12), so each component is proven through the pure
// function it calls. The rules those functions mirror are enforced and tested
// in Postgres (supabase/tests/dc_only_numbering_on_insert.test.sql,
// documents_require_mdr_settings.test.sql, rls_document_register.test.sql).
import { describe, expect, it } from 'vitest'
import {
  HISTORY_EMPTY_MESSAGE,
  PANEL_ACTIONS,
  PLACEHOLDER_TABS,
  cpyFieldHint,
  cpyFieldMode,
  describeAuditRow,
  dictionaryLabel,
  fileDisplayName,
  formatAuditValue,
  formatFileSize,
  formatTimestamp,
  historyRecordIds,
  personName,
  type AuditRow,
} from './document-profile'

const USER = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'
const REV = '33333333-3333-4333-8333-333333333333'
const names = new Map<string, string | null>([[USER, 'Ada Lovelace']])

describe('dictionaryLabel', () => {
  it('shows code and label, never an id', () => {
    expect(dictionaryLabel({ code: 'RA', label: 'Report' })).toBe('RA — Report')
  })

  it('does not repeat a value that is its own label', () => {
    expect(dictionaryLabel({ code: 'IDC', label: 'IDC' })).toBe('IDC')
  })

  it('falls back to whichever half exists', () => {
    expect(dictionaryLabel({ code: 'RA', label: null })).toBe('RA')
    expect(dictionaryLabel({ code: null, label: 'Report' })).toBe('Report')
    expect(dictionaryLabel({ code: '  ', label: '' })).toBe('—')
  })

  // A status row a future policy hides comes back as a null embed; the profile
  // must render a dash, not throw.
  it('degrades a missing embed to a dash', () => {
    expect(dictionaryLabel(null)).toBe('—')
    expect(dictionaryLabel(undefined)).toBe('—')
  })
})

describe('personName', () => {
  it('resolves a listed profile to a name', () => {
    expect(personName(USER, names)).toBe('Ada Lovelace')
  })

  it('shows a short id for a profile the directory does not list, and a dash for none', () => {
    expect(personName('99999999-1111-4111-8111-111111111111', names)).toBe('99999999…')
    expect(personName(null, names)).toBe('—')
  })
})

describe('formatTimestamp', () => {
  it('prints UTC to the minute, whatever the machine timezone', () => {
    expect(formatTimestamp('2026-09-19T14:33:50.123+00:00')).toBe('2026-09-19 14:33 UTC')
    expect(formatTimestamp('2026-09-19T16:33:50+02:00')).toBe('2026-09-19 14:33 UTC')
  })

  it('returns a dash for nothing or nonsense', () => {
    expect(formatTimestamp(null)).toBe('—')
    expect(formatTimestamp('not a date')).toBe('—')
  })
})

describe('cpyFieldMode — mirrors the three database guards', () => {
  it('is editable only for the project DC, in an aal2 session, on a project with a CPY track', () => {
    expect(cpyFieldMode({ cpyNumbering: true, isProjectDc: true, aal2: true })).toEqual({ mode: 'editable' })
  })

  it('is read-only for everyone who is not the project DC', () => {
    expect(cpyFieldMode({ cpyNumbering: true, isProjectDc: false, aal2: true })).toEqual({
      mode: 'read_only',
      reason: 'not_dc',
    })
    // aal2 is irrelevant to someone who is not the DC.
    expect(cpyFieldMode({ cpyNumbering: true, isProjectDc: false, aal2: false })).toEqual({
      mode: 'read_only',
      reason: 'not_dc',
    })
  })

  // The DC at aal1 is the one reader told what to fix.
  it('tells a DC without a verified second factor to verify it', () => {
    expect(cpyFieldMode({ cpyNumbering: true, isProjectDc: true, aal2: false })).toEqual({
      mode: 'read_only',
      reason: 'needs_second_factor',
    })
  })

  // Order: a project with no CPY track is "numbering off" for EVERYONE, DC
  // included — telling the DC it is read-only because they are not the DC would
  // be a false reason.
  it('reports numbering off before it looks at the reader', () => {
    for (const isProjectDc of [true, false]) {
      for (const aal2 of [true, false]) {
        expect(cpyFieldMode({ cpyNumbering: false, isProjectDc, aal2 })).toEqual({ mode: 'numbering_off' })
      }
    }
  })
})

describe('cpyFieldHint', () => {
  it('has nothing to say to an editor', () => {
    expect(cpyFieldHint({ mode: 'editable' })).toBeNull()
  })

  it('gives each read-only state its own sentence', () => {
    const hints = [
      cpyFieldHint({ mode: 'numbering_off' }),
      cpyFieldHint({ mode: 'read_only', reason: 'not_dc' }),
      cpyFieldHint({ mode: 'read_only', reason: 'needs_second_factor' }),
    ]
    expect(hints.every((hint) => typeof hint === 'string' && hint.length > 0)).toBe(true)
    expect(new Set(hints).size).toBe(3)
    expect(hints[2]).toMatch(/second factor/)
  })
})

describe('formatFileSize', () => {
  it('formats bytes, KB, MB and GB', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatFileSize(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('returns a dash for a row that never recorded a size', () => {
    expect(formatFileSize(null)).toBe('—')
    expect(formatFileSize(undefined)).toBe('—')
    expect(formatFileSize(-1)).toBe('—')
  })
})

describe('fileDisplayName', () => {
  // file_name, original_name and storage_path are all nullable until 1b.09.
  it('prefers file_name, then original_name, then the storage path leaf', () => {
    expect(fileDisplayName({ file_name: 'a.pdf', original_name: 'b.pdf', storage_path: 'x/c.pdf' })).toBe('a.pdf')
    expect(fileDisplayName({ file_name: null, original_name: 'b.pdf', storage_path: 'x/c.pdf' })).toBe('b.pdf')
    expect(fileDisplayName({ file_name: null, original_name: null, storage_path: 'x/y/c.pdf' })).toBe('c.pdf')
  })

  it('still lists a row that has none of them', () => {
    expect(fileDisplayName({ file_name: null, original_name: null, storage_path: null })).toBe('(unnamed file)')
  })
})

// Acceptance 6: every action present, with the tooltip the task specifies.
describe('PANEL_ACTIONS', () => {
  const byLabel = new Map(PANEL_ACTIONS.map((action) => [action.label, action.hint]))

  it('renders the six actions', () => {
    expect([...byLabel.keys()]).toEqual([
      'New Revision',
      'Add File',
      'Distribute for IDC',
      'Initiate Review',
      'Initiate Approval',
      'Create Transmittal',
    ])
  })

  it('names 1b.08 and 1b.09 on the two that arrive next', () => {
    expect(byLabel.get('New Revision')).toMatch(/1b\.08/)
    expect(byLabel.get('Add File')).toMatch(/1b\.09/)
  })

  it('says "Phase 2/3" on the other four', () => {
    for (const label of ['Distribute for IDC', 'Initiate Review', 'Initiate Approval', 'Create Transmittal']) {
      expect(byLabel.get(label)).toBe('Phase 2/3')
    }
  })
})

describe('PLACEHOLDER_TABS', () => {
  it('has the five tabs of the task, with Revisions pointing at 1b.08', () => {
    expect(PLACEHOLDER_TABS.map((tab) => tab.label)).toEqual([
      'Revisions',
      'Plan',
      'Comments',
      'References',
      'Transmittals',
    ])
    expect(PLACEHOLDER_TABS[0].sentence).toMatch(/1b\.08/)
  })

  // The owner's decision (1b.07 review), pinned so a reword cannot drop it.
  it('names DCS 2.09 on Comments and "no task number yet" on References', () => {
    const sentence = (value: string) => PLACEHOLDER_TABS.find((tab) => tab.value === value)?.sentence
    expect(sentence('comments')).toMatch(/DCS 2\.09 · Phase 2/)
    expect(sentence('references')).toMatch(/Phase 2 \(document_references in the ERD, no task number yet\)/)
  })

  it('has one sentence per tab and no duplicate values', () => {
    expect(new Set(PLACEHOLDER_TABS.map((tab) => tab.value)).size).toBe(PLACEHOLDER_TABS.length)
    expect(PLACEHOLDER_TABS.every((tab) => tab.sentence.length > 0)).toBe(true)
  })
})

describe('historyRecordIds', () => {
  it('is the document alone until a revision exists', () => {
    expect(historyRecordIds(DOC, [])).toEqual([DOC])
  })

  it('adds every revision id after the document id', () => {
    expect(historyRecordIds(DOC, [REV])).toEqual([DOC, REV])
  })
})

const auditRow = (overrides: Partial<AuditRow>): AuditRow => ({
  id: 'a1',
  occurred_at: '2026-09-19T14:33:50+00:00',
  user_id: USER,
  table_name: 'dcs.documents',
  record_id: DOC,
  action: 'UPDATE',
  field_name: 'cpy_doc_number',
  old_value: null,
  new_value: 'CPY-0042',
  ...overrides,
})

describe('describeAuditRow', () => {
  // Acceptance 3: the CPY change must be readable as exactly that in History.
  it('turns a CPY change into a Changed line with old -> new and the actor by name', () => {
    expect(describeAuditRow(auditRow({ old_value: 'CPY-0001', new_value: 'CPY-0042' }), names)).toEqual({
      id: 'a1',
      occurredAt: '2026-09-19T14:33:50+00:00',
      actor: 'Ada Lovelace',
      scope: 'Document',
      action: 'Changed',
      field: 'cpy_doc_number',
      from: 'CPY-0001',
      to: 'CPY-0042',
    })
  })

  it('leaves an empty side as null, so the tab prints a dash and not the word null', () => {
    const entry = describeAuditRow(auditRow({ old_value: null, new_value: 'CPY-0042' }), names)
    expect(entry.from).toBeNull()
    expect(entry.to).toBe('CPY-0042')
  })

  // INSERT/DELETE rows carry the whole row (audit_trigger): printing a
  // 15-column JSON blob would bury the field changes.
  it('collapses a whole-row INSERT or DELETE to one line with no old -> new', () => {
    const created = describeAuditRow(
      auditRow({ action: 'INSERT', field_name: null, old_value: null, new_value: { id: DOC, title: 'X' } }),
      names,
    )
    expect(created).toMatchObject({ action: 'Created', field: null, from: null, to: null })
    const deleted = describeAuditRow(
      auditRow({ action: 'DELETE', field_name: null, old_value: { id: DOC }, new_value: null }),
      names,
    )
    expect(deleted).toMatchObject({ action: 'Deleted', field: null, from: null, to: null })
  })

  it('labels the table it came from', () => {
    expect(describeAuditRow(auditRow({ table_name: 'dcs.revisions' }), names).scope).toBe('Revision')
    expect(describeAuditRow(auditRow({ table_name: 'dcs.files' }), names).scope).toBe('dcs.files')
  })

  it('names a sessionless write instead of showing an id', () => {
    expect(describeAuditRow(auditRow({ user_id: null }), names).actor).toBe('System (no session)')
  })
})

describe('formatAuditValue', () => {
  it('resolves the person columns to names and leaves other strings alone', () => {
    expect(formatAuditValue(USER, 'originator_id', names)).toBe('Ada Lovelace')
    expect(formatAuditValue(USER, 'checker_id', names)).toBe('Ada Lovelace')
    expect(formatAuditValue('CPY-1', 'cpy_doc_number', names)).toBe('CPY-1')
  })

  it('renders numbers and booleans as text and null as null', () => {
    expect(formatAuditValue(12.5, 'budget_hours', names)).toBe('12.5')
    expect(formatAuditValue(false, 'x', names)).toBe('false')
    expect(formatAuditValue(null, 'x', names)).toBeNull()
  })
})

// Acceptance 4: an empty read must not claim the document is unchanged.
describe('HISTORY_EMPTY_MESSAGE', () => {
  it('says entries may be hidden by the reader’s role, naming who can read them', () => {
    expect(HISTORY_EMPTY_MESSAGE).toMatch(/may exist/)
    expect(HISTORY_EMPTY_MESSAGE).toMatch(/administrators/)
    expect(HISTORY_EMPTY_MESSAGE).toMatch(/Document Controller/)
  })
})
