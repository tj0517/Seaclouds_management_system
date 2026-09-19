// DCS 1b.06: the .xlsx export's structure.
//
// What is provable here and what is not, stated up front so nobody reads more
// into a green run than it carries:
//
//   * PROVABLE HERE: the filename, the grouped header, the cell values and
//     their order, and that the workbook is real xlsx a reader can open.
//   * NOT PROVABLE HERE: that the rows in the sheet are the rows the register
//     would show for the same filters. That question crosses PostgREST and is
//     answered end to end by scripts/mdr-export-fidelity.mjs against a seeded
//     local stack. lib/mdr.test.ts covers the half that can be unit tested —
//     that listMdrAll and listMdrPage build the identical query.
import { describe, expect, it } from 'vitest'
import {
  buildMdrWorkbook,
  mdrExportFilename,
  mdrSheetHeader,
  mdrSheetRow,
} from './mdr-export'
import {
  MDR_COLUMN_COUNT,
  parseMdrSearchParams,
  visibleColumnGroups,
  type MdrRow,
} from './mdr'

const NAME_FOR = (id: string | null) => (id ? `Person ${id}` : '')

/**
 * Reads a built workbook back, the way Excel would.
 *
 * The cast is between two spellings of the same bytes: @types/node now writes
 * Buffer as Buffer<ArrayBufferLike>, exceljs's bundled signature predates the
 * generic. Narrowed to the parameter's own type rather than `any` (the ban in
 * docs/03-conventions.md is about queries, but `any` here would hide a real
 * signature change just as well).
 */
async function readBack(buffer: Buffer) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  type Loadable = Parameters<typeof workbook.xlsx.load>[0]
  await workbook.xlsx.load(buffer as unknown as Loadable)
  const sheet = workbook.getWorksheet('MDR')
  // Not a non-null assertion: if the sheet is missing, the assertion that
  // should fail is this one, naming the reason, rather than a cell read
  // blowing up three lines later.
  if (!sheet) throw new Error('the workbook has no MDR worksheet')
  return sheet
}

/** A register row with only the fields the assertions below look at. */
function row(overrides: Partial<MdrRow> = {}): MdrRow {
  return {
    document_id: 'd1',
    scl_doc_number: 'SC2602-SCL-RA-0001-EN',
    cpy_doc_number: null,
    title: 'Synthetic row',
    process: 'internal',
    orig_code: 'SCL',
    seq: '0001',
    doc_type_code: 'RA',
    doc_type_description: 'Report',
    discipline_code: 'A00',
    ctr_code: null,
    budget_hours: 12,
    cpy_revision: null,
    scl_revision: null,
    issue_date: null,
    workflow_status_code: 'IDC',
    workflow_status_label: 'Inter-discipline check',
    workflow_type: null,
    originator_id: null,
    checker_id: null,
    approver_id: null,
    ...overrides,
  } as MdrRow
}

// ---------------------------------------------------------------------------
// The filename — acceptance criterion 2
// ---------------------------------------------------------------------------

describe('mdrExportFilename', () => {
  const DAY = new Date(2026, 8, 19) // local-time construction; the name is local

  it('matches MDR_[project_code]_[YYYY-MM-DD].xlsx', () => {
    expect(mdrExportFilename('SC2602', DAY)).toBe('MDR_SC2602_2026-09-19.xlsx')
    expect(mdrExportFilename('SC2602', DAY)).toMatch(/^MDR_.+_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('keeps a hyphenated project code intact — SCMS-IT is a live code (O-11)', () => {
    expect(mdrExportFilename('SCMS-IT', DAY)).toBe('MDR_SCMS-IT_2026-09-19.xlsx')
  })

  it('says ALL when no project filter is active', () => {
    expect(mdrExportFilename(null, DAY)).toBe('MDR_ALL_2026-09-19.xlsx')
    expect(mdrExportFilename('  ', DAY)).toBe('MDR_ALL_2026-09-19.xlsx')
  })

  it('pads single-digit months and days, so the name sorts', () => {
    expect(mdrExportFilename('SC2602', new Date(2026, 0, 5))).toBe('MDR_SC2602_2026-01-05.xlsx')
  })

  // Sanitisation maps every unsafe character to the same underscore, so two
  // different codes CAN produce the same filename ('A/B' and 'A B' both give
  // A_B). That is accepted: a filename is a label on a download, not an
  // identity, and no live project_code contains either character (the CHECK in
  // 20260901082600 admits ^SC\d{4}$, ^SCMS and the named SCC005 exception).
  // What matters is that nothing unsafe survives into the name.
  it('replaces anything that could break a filename or escape a directory', () => {
    expect(mdrExportFilename('A/B', DAY)).toBe('MDR_A_B_2026-09-19.xlsx')
    expect(mdrExportFilename('../etc', DAY)).toBe('MDR_.._etc_2026-09-19.xlsx')
    expect(mdrExportFilename('a"b\'c', DAY)).toBe('MDR_a_b_c_2026-09-19.xlsx')
    expect(mdrExportFilename('SC2602', DAY)).not.toMatch(/[\/\\"']/)
  })
})

// ---------------------------------------------------------------------------
// The grouped header — acceptance criterion 3 (annex C survives the export)
// ---------------------------------------------------------------------------

describe('mdrSheetHeader', () => {
  it('mirrors the on-screen grouping: one band per group, spanning its columns', () => {
    const header = mdrSheetHeader(visibleColumnGroups([]))
    expect(header.spans.map((s) => s.label)).toEqual([
      'DOCUMENT INFO', 'STATUS', 'WORKFLOW', 'IDC', 'IFR', 'RETCOM', 'IFC / IFI',
    ])
    expect(header.spans.reduce((n, s) => n + s.span, 0)).toBe(MDR_COLUMN_COUNT)
    expect(header.labels).toHaveLength(MDR_COLUMN_COUNT)
  })

  it('narrows the bands when columns are hidden, and drops emptied groups', () => {
    const header = mdrSheetHeader(visibleColumnGroups(['scl_doc_number', 'issue_date']))
    expect(header.spans).toEqual([
      { label: 'DOCUMENT INFO', span: 1 },
      { label: 'STATUS', span: 1 },
    ])
    expect(header.labels).toEqual(['SCL Doc. Number', 'Issue Date'])
  })

  it('keeps the two header rows in step — a band never spans more than it has', () => {
    const header = mdrSheetHeader(visibleColumnGroups(['scl_doc_number', 'title', 'issue_date']))
    expect(header.spans.reduce((n, s) => n + s.span, 0)).toBe(header.labels.length)
  })
})

// ---------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------

describe('mdrSheetRow', () => {
  it('emits one cell per visible column, left to right, in annex-C order', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'title', 'budget_hours'])
    expect(mdrSheetRow(row(), groups, NAME_FOR)).toEqual([
      'SC2602-SCL-RA-0001-EN',
      'Synthetic row',
      12,
    ])
  })

  it('writes budget hours as a NUMBER, so the DC can sum the column', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'budget_hours'])
    expect(mdrSheetRow(row({ budget_hours: 7.5 }), groups, NAME_FOR)[1]).toBe(7.5)
  })

  it('shows the status LABEL, the same text the badge shows', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'workflow_status_code'])
    expect(mdrSheetRow(row(), groups, NAME_FOR)[1]).toBe('Inter-discipline check')
  })

  it('falls back to the code when the label is missing — v_mdr LEFT JOINs the dictionary', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'workflow_status_code'])
    const cells = mdrSheetRow(row({ workflow_status_label: null }), groups, NAME_FOR)
    expect(cells[1]).toBe('IDC')
  })

  it('resolves the three staffing ids through the caller-supplied directory', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'originator_id'])
    expect(mdrSheetRow(row({ originator_id: 'u1' }), groups, NAME_FOR)[1]).toBe('Person u1')
  })

  // A column of text that merely LOOKS like a date is how an exported register
  // stops being sortable the first time someone tries.
  it('writes a date as a real Date, not as dd.MM.yyyy text', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'issue_date'])
    const cell = mdrSheetRow(row({ issue_date: '2026-09-19' }), groups, NAME_FOR)[1]
    expect(cell).toBeInstanceOf(Date)
    expect((cell as Date).toISOString().slice(0, 10)).toBe('2026-09-19')
  })

  // Parsed at UTC noon precisely so a negative local offset cannot roll the
  // cell onto the previous day — the TES weekStart() class of bug.
  it('does not shift a date across a day boundary in a western timezone', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'issue_date'])
    const cell = mdrSheetRow(row({ issue_date: '2026-01-01' }), groups, NAME_FOR)[1] as Date
    expect(cell.getUTCDate()).toBe(1)
    expect(cell.getUTCMonth()).toBe(0)
  })

  it('leaves an empty date empty rather than writing epoch zero', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'issue_date'])
    expect(mdrSheetRow(row({ issue_date: null }), groups, NAME_FOR)[1]).toBeNull()
  })

  it('emits the sixteen Phase-2 stage cells as empty, not as missing columns', () => {
    const cells = mdrSheetRow(row(), visibleColumnGroups([]), NAME_FOR)
    expect(cells).toHaveLength(MDR_COLUMN_COUNT)
  })
})

// ---------------------------------------------------------------------------
// The workbook — acceptance criterion 2 ("opens without a repair prompt")
// ---------------------------------------------------------------------------

describe('buildMdrWorkbook', () => {
  const INPUT = {
    rows: [row(), row({ document_id: 'd2', scl_doc_number: 'SC2602-SCL-RA-0002-EN' })],
    query: parseMdrSearchParams({}),
    nameFor: NAME_FOR,
    projectCode: 'SC2602',
    generatedAt: new Date(2026, 8, 19),
    truncated: false,
  }

  it('produces a real xlsx — a ZIP whose first bytes are the PK signature', async () => {
    const buffer = await buildMdrWorkbook(INPUT)
    expect(buffer.length).toBeGreaterThan(0)
    // Excel's "we found a problem with some content" prompt is what a
    // malformed container produces; the magic number is the cheapest check
    // that we wrote one at all. Opening it for real is the fidelity script's
    // job, which reads the file back with exceljs.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('reads back with the header rows and one row per document, in order', async () => {
    const sheet = await readBack(await buildMdrWorkbook(INPUT))

    expect(sheet.getRow(1).getCell(1).value).toBe('DOCUMENT INFO')
    expect(sheet.getRow(2).getCell(5).value).toBe('SCL Doc. Number')
    expect(sheet.getRow(3).getCell(5).value).toBe('SC2602-SCL-RA-0001-EN')
    expect(sheet.getRow(4).getCell(5).value).toBe('SC2602-SCL-RA-0002-EN')
  })

  it('fills the status cell from MDR_STATUS_COLORS, not from a palette of its own', async () => {
    const { MDR_STATUS_COLORS } = await import('./mdr')
    const sheet = await readBack(await buildMdrWorkbook(INPUT))

    // Located rather than hard-coded: a column added to DOCUMENT INFO in
    // Phase 2 would shift a literal index and make this assert the wrong cell
    // while still passing for the wrong reason.
    const { visibleColumnGroups: groupsOf } = await import('./mdr')
    const index = groupsOf([])
      .flatMap((g) => g.columns)
      .findIndex((c) => c.key === 'workflow_status_code')
    const status = sheet.getRow(3).getCell(index + 1)
    expect(status.value).toBe('Inter-discipline check')
    expect((status.fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe(
      MDR_STATUS_COLORS.IDC?.argb,
    )
  })

  it('says on the sheet when the export was cut short, rather than leaving it to be discovered', async () => {
    const sheet = await readBack(await buildMdrWorkbook({ ...INPUT, truncated: true }))
    const last = sheet.getRow(sheet.rowCount).getCell(1).value
    expect(String(last)).toMatch(/INCOMPLETE EXPORT/)
  })

  it('exports only the visible columns when the user has narrowed them', async () => {
    const sheet = await readBack(
      await buildMdrWorkbook({
        ...INPUT,
        query: { ...INPUT.query, columns: ['scl_doc_number', 'title'] },
      }),
    )
    expect(sheet.getRow(2).getCell(1).value).toBe('SCL Doc. Number')
    expect(sheet.getRow(2).getCell(2).value).toBe('Title')
    expect(sheet.getRow(2).getCell(3).value).toBeNull()
  })

  it('survives an empty register — a filter matching nothing is a sheet, not a crash', async () => {
    const buffer = await buildMdrWorkbook({ ...INPUT, rows: [] })
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
