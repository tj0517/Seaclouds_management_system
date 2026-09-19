// DCS 1b.06: the MDR register as an .xlsx — brief §9.2, "export what I see".
//
// Same split as lib/mdr.ts and lib/documents.ts: takes plain data, imports
// nothing from Next.js, runs from a server action or a Vitest test alike.
//
// WHAT THIS MODULE IS NOT ALLOWED TO DECIDE, and the reason each one lives
// somewhere else:
//
//   * WHICH ROWS. It receives them. listMdrAll() in lib/mdr.ts builds the
//     query through the same applyMdrQuery() the register screen uses, so the
//     sheet and the screen cannot disagree about filters, search or order.
//     A query built here would be a second answer to that question.
//   * WHICH COLUMNS. visibleColumnGroups() in lib/mdr.ts, the same call the
//     page's header and body make.
//   * WHAT A CELL SAYS. mdrCellValue(), again shared with the page.
//   * WHAT COLOUR A STATUS IS. mdrStatusFill() reads MDR_STATUS_COLORS — the
//     one provisional palette, whose entries carry both the Tailwind classes
//     the badge uses and the ARGB the fill below uses. There is deliberately
//     NO colour literal anywhere in this file except the two neutral greys of
//     the header chrome, which are not status colours and answer to nobody's
//     open question. O-05 is resolved by editing that constant and nothing
//     else.
//
// This file owns exactly one thing: the shape of the workbook.
import {
  columnCount,
  formatMdrDate,
  listMdrAll,
  mdrCellValue,
  mdrStatusFill,
  parseMdrSearchParams,
  visibleColumnGroups,
  type MdrColumnGroup,
  type MdrNameResolver,
  type MdrQuery,
  type MdrRow,
  type RawSearchParams,
} from './mdr'
import { getProfileDirectory } from './profile-directory'

/** The date columns, written as real dates so Excel can sort and filter them. */
const DATE_KEYS = new Set<string>([
  'issue_date',
  'idc_planned', 'idc_forecast', 'idc_actual',
  'ifr_planned', 'ifr_forecast', 'ifr_actual',
  'retcom_planned', 'retcom_forecast', 'retcom_actual',
  'ifc_ifi_planned', 'ifc_ifi_forecast', 'ifc_ifi_actual',
])

/** dd.mm.yyyy in Excel's own format language — renders identically to the screen. */
const DATE_FORMAT = 'dd.mm.yyyy'

/** Neutral chrome for the two header rows. Not status colours; see the header. */
const GROUP_HEADER_FILL = 'FFE2E8F0'
const COLUMN_HEADER_FILL = 'FFF1F5F9'

/**
 * The filename, `MDR_[project_code]_[YYYY-MM-DD].xlsx`.
 *
 * `ALL` when no project filter is active, because there is then no single
 * project code and the register genuinely spans every project the caller can
 * read. Agreed with the owner 2026-09-19 as the sensible reading of a
 * requirement written for the filtered case.
 *
 * The code is sanitised because it becomes a download filename: live codes
 * contain hyphens (`SCMS-IT`, O-11) which are fine, but nothing guarantees a
 * future one is free of a slash or a quote. Anything outside the safe set
 * becomes an underscore.
 *
 * That mapping is MANY-TO-ONE — 'A/B' and 'A B' both give 'A_B' — and it is
 * accepted rather than worked around: a filename is a label on a download, not
 * an identity, and no code that can exist today contains either character
 * (the CHECK in 20260901082600 admits ^SC\d{4}$, ^SCMS and the named SCC005
 * exception). If project codes ever open up, this is where to look.
 */
export function mdrExportFilename(projectCode: string | null, generatedAt: Date): string {
  const code = (projectCode ?? '').trim()
  const safe = code ? code.replace(/[^A-Za-z0-9._-]/g, '_') : 'ALL'
  const day = [
    generatedAt.getFullYear(),
    String(generatedAt.getMonth() + 1).padStart(2, '0'),
    String(generatedAt.getDate()).padStart(2, '0'),
  ].join('-')
  return `MDR_${safe}_${day}.xlsx`
}

/**
 * The two header rows, derived from the visible groups.
 *
 * `spans` drives the merges in row 1 and `labels` fills row 2, so the sheet's
 * grouped header comes from exactly the structure the screen's two <tr>s come
 * from — annex C's grouping, preserved in the file the DC opens.
 */
export function mdrSheetHeader(groups: readonly MdrColumnGroup[]): {
  spans: { label: string; span: number }[]
  labels: string[]
} {
  return {
    spans: groups.map((group) => ({ label: group.label, span: group.columns.length })),
    labels: groups.flatMap((group) => group.columns.map((column) => column.label)),
  }
}

/**
 * One register row as a flat array of cell values, left to right.
 *
 * Dates come back as Date objects rather than the screen's dd.MM.yyyy string:
 * the cell is formatted with DATE_FORMAT so it READS identically, while
 * staying sortable and filterable in Excel. A column of text that looks like a
 * date is the classic way an exported register becomes unusable the moment
 * someone tries to sort it.
 */
export function mdrSheetRow(
  row: MdrRow,
  groups: readonly MdrColumnGroup[],
  nameFor: MdrNameResolver,
): (string | number | Date | null)[] {
  return groups.flatMap((group) =>
    group.columns.map((column) => {
      const key = column.key
      if (key !== null && DATE_KEYS.has(key)) {
        const raw = row[key]
        if (typeof raw !== 'string' || raw === '') return null
        // The view hands these over as ISO dates (YYYY-MM-DD). Parsed as UTC
        // noon rather than midnight so a negative local offset cannot roll the
        // cell back onto the previous day — the same class of bug the TES
        // weekStart() fix dealt with.
        const [y, m, d] = raw.split('-').map(Number)
        if (!y || !m || !d) return formatMdrDate(raw)
        return new Date(Date.UTC(y, m - 1, d, 12))
      }
      return mdrCellValue(row, key, nameFor)
    }),
  )
}

export type MdrWorkbookInput = {
  rows: MdrRow[]
  query: MdrQuery
  nameFor: MdrNameResolver
  /** The filtered project's code, or null when the export spans every project. */
  projectCode: string | null
  generatedAt: Date
  /** True when listMdrAll() hit its ceiling — said on the sheet, not swallowed. */
  truncated: boolean
}

/**
 * The workbook, as bytes.
 *
 * exceljs is imported dynamically for the same reason TES's pdf.ts imports
 * pdfkit that way: it is a large dependency used by one action, and a static
 * import would pull it into every server bundle that merely touches this
 * module's types.
 */
export async function buildMdrWorkbook(input: MdrWorkbookInput): Promise<Buffer> {
  const ExcelJSModule = (await import('exceljs')).default
  const groups = visibleColumnGroups(input.query.columns)
  const total = columnCount(groups)
  const header = mdrSheetHeader(groups)

  const workbook = new ExcelJSModule.Workbook()
  workbook.created = input.generatedAt
  const sheet = workbook.addWorksheet('MDR', {
    views: [
      // Freeze both header rows AND the columns up to and including the SCL
      // number, so scrolling right across 35 columns never loses which
      // document a row is. ySplit 2 = the two header rows.
      { state: 'frozen', xSplit: Math.min(5, total), ySplit: 2 },
    ],
  })

  // --- Row 1: the annex-C group bands, merged across their columns ---------
  const groupRow = sheet.addRow(header.spans.flatMap((g) => [g.label, ...Array(g.span - 1).fill(null)]))
  let at = 1
  for (const group of header.spans) {
    if (group.span > 1) sheet.mergeCells(1, at, 1, at + group.span - 1)
    at += group.span
  }
  groupRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 9 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_HEADER_FILL } }
  })

  // --- Row 2: the column headings -----------------------------------------
  const labelRow = sheet.addRow(header.labels)
  labelRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 9 }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLUMN_HEADER_FILL } }
  })

  // The filter dropdowns sit on the heading row, never on the group bands —
  // an autoFilter anchored at row 1 would treat a merged band as the heading
  // and offer "DOCUMENT INFO" as a filter for eleven different columns.
  if (total > 0) {
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: total } }
  }

  // --- The rows ------------------------------------------------------------
  // In the order listMdrAll() returned them. Nothing here sorts, filters or
  // slices: the register's order IS the sheet's order, which is half of what
  // acceptance criterion 1 checks.
  const statusIndex = header.labels.length > 0
    ? groups.flatMap((g) => g.columns).findIndex((c) => c.key === 'workflow_status_code')
    : -1

  for (const row of input.rows) {
    const added = sheet.addRow(mdrSheetRow(row, groups, input.nameFor))
    added.font = { size: 9 }

    for (const [index, column] of groups.flatMap((g) => g.columns).entries()) {
      const cell = added.getCell(index + 1)
      if (column.key !== null && DATE_KEYS.has(column.key)) cell.numFmt = DATE_FORMAT
      if (column.numeric) cell.alignment = { horizontal: 'right' }
    }

    // The status cell, in the same provisional colour the badge on screen
    // uses — MDR_STATUS_COLORS, via mdrStatusFill(). An unknown or missing
    // code lands on the neutral fallback exactly as it does on screen.
    if (statusIndex >= 0) {
      added.getCell(statusIndex + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: mdrStatusFill(row.workflow_status_code) },
      }
    }
  }

  // --- Widths --------------------------------------------------------------
  // From the heading, with the few columns that hold prose given room. Not
  // measured from the data: a register whose widths shift with whichever rows
  // happened to be exported is one the DC cannot compare with last week's.
  const WIDE: Record<string, number> = {
    title: 46,
    doc_type_description: 30,
    scl_doc_number: 24,
    cpy_doc_number: 22,
    ctr_description: 24,
  }
  for (const [index, column] of groups.flatMap((g) => g.columns).entries()) {
    const key = column.key ?? ''
    sheet.getColumn(index + 1).width = WIDE[key] ?? Math.max(10, column.label.length + 3)
  }

  // --- The footnote --------------------------------------------------------
  // Two rows below the data, in the sheet rather than only in the UI, because
  // the file outlives the screen it was exported from: whoever opens it next
  // week has no other way to learn that the empty stage columns are a phase
  // that has not arrived and that the colours are not agreed.
  sheet.addRow([])
  const note = sheet.addRow([
    input.truncated
      ? 'INCOMPLETE EXPORT — the filter matched more rows than one export carries. Narrow the filters and export again.'
      : 'The four stage groups (IDC / IFR / RETCOM / IFC-IFI) and WORKFLOW > Type have no data yet: planned and forecast dates arrive with the scheduling phase. Status colours are provisional pending the mapping agreed with the Document Controller.',
  ])
  note.font = { size: 8, italic: true, color: { argb: input.truncated ? 'FFB91C1C' : 'FF64748B' } }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// ---------------------------------------------------------------------------
// The whole export, from a client and a URL (DCS 1b.06)
// ---------------------------------------------------------------------------

/**
 * Everything the "Export to Excel" action does, minus the Next.js glue.
 *
 * Split out from app/data/actions/mdr-export.ts so the fidelity proof can run
 * THE FUNCTION THE ACTION CALLS rather than a reimplementation of it against
 * the same database. scripts/mdr-export-fidelity.mjs seeds the local stack,
 * calls this with a real signed-in client, reads the .xlsx back and diffs its
 * rows against `select … from dcs.v_mdr where <same filters>`. What that
 * leaves unproven is the action's remaining ten lines — reading the session
 * from cookies and base64-encoding the buffer — and nothing about which rows
 * the sheet contains.
 */
export async function exportMdr(
  supabase: Parameters<typeof listMdrAll>[0],
  params: RawSearchParams,
): Promise<{
  filename: string
  buffer: Buffer
  rowCount: number
  truncated: boolean
}> {
  const query = parseMdrSearchParams(params)

  const [{ rows, truncated }, directory] = await Promise.all([
    listMdrAll(supabase, query),
    getProfileDirectory(supabase),
  ])

  const nameById = new Map(directory.entries.map((entry) => [entry.id, entry.full_name]))
  // Same rule as the screen's person(): a colleague outside every shared
  // project is not in the directory, and a short id reads as "someone you
  // cannot see" rather than as "unstaffed".
  const nameFor = (id: string | null) => (id ? (nameById.get(id) ?? `${id.slice(0, 8)}…`) : '')

  // The project code for the filename, taken from the exported rows rather
  // than by a second query on public.projects: if the filter matched anything
  // its code is already here, and if it matched nothing there is no register
  // to name.
  const projectCode = query.projectId ? (rows[0]?.project_code ?? null) : null
  const generatedAt = new Date()

  return {
    filename: mdrExportFilename(projectCode, generatedAt),
    buffer: await buildMdrWorkbook({ rows, query, nameFor, projectCode, generatedAt, truncated }),
    rowCount: rows.length,
    truncated,
  }
}
