// DCS 1b.05: the MDR register — the read layer and every decision the screen
// makes before it renders.
//
// Same split as lib/documents.ts and lib/project-mdr.ts: takes any typed
// Supabase client and imports nothing from Next.js, so it runs from an RSC or
// from a Vitest test alike. There is no write half — the register reads.
//
// THE RULE THIS FILE LIVES UNDER: filtering, searching, sorting and paging all
// happen in SQL. Nothing in this module may call .filter(), .sort() or .slice()
// on the rows a query returned. The register is the screen the whole company
// opens, it will hold 146 documents after the 1b.13 import and thousands after
// that, and a page that fetches everything and narrows it in JavaScript works
// perfectly at 1 row and falls over exactly when it matters. lib/mdr.test.ts
// asserts this against a stub client that records the calls.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@scl/db'

/**
 * A register row as the page receives it: every column of dcs.v_mdr EXCEPT
 * search_text, which the query filters on and never selects (see MDR_SELECT).
 * Written as an Omit of the generated view row rather than a hand-listed Pick,
 * so a column added to the view in Phase 2 arrives here by regenerating types.
 */
export type MdrRow = Omit<Tables<{ schema: 'dcs' }, 'v_mdr'>, 'search_text'>

type DbClient = SupabaseClient<Database>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Status colours
// ---------------------------------------------------------------------------

/**
 * PROVISIONAL PALETTE — NOT the agreed status colours. O-05 is open.
 *
 * docs/04-open-questions.md, O-05: "mapping the colours of column E of the
 * SMDR sheet onto workflow_status" is still unresolved, and the decision is
 * the client's Document Controller's, not ours. No `workflow_status` row in
 * dcs.dictionaries carries a colour either — all nine have `meta = {}` (read
 * from scl-dev 2026-09-19), so there is nothing in the database to read one
 * from.
 *
 * These nine values were therefore CHOSEN, knowingly, so the register can ship
 * and be demonstrated. They follow the lifecycle's own logic — grey before
 * work starts, blue while it is in hand, amber through review, green once
 * issued, red for Void — which is the obvious reading of the sheet, and the
 * obvious reading is exactly the kind of thing that turns out to be wrong.
 * Do not describe them to anyone as the agreed mapping.
 *
 * THE ONLY THING THAT MATTERS ARCHITECTURALLY: this constant is the single
 * place they live. Answering O-05 is editing this object, or replacing its
 * body with a read of dcs.dictionaries.meta.color — nothing else in the app
 * knows a status colour.
 *
 * Keys are dictionary CODES, not ids: ids differ between local, scl-dev and
 * prod, codes do not. Light-theme classes only, matching globals.css ("Light
 * theme only, by this task's scope" — nothing in DCS ever sets .dark).
 *
 * ---------------------------------------------------------------------------
 * 1b.06: EACH ENTRY NOW CARRIES BOTH RENDERINGS OF THE SAME COLOUR
 * ---------------------------------------------------------------------------
 * The .xlsx export has to fill a status cell, and a spreadsheet knows nothing
 * about `bg-amber-50`. The alternative — a hex table living in the export
 * module — would be a SECOND palette: answering O-05 would then mean editing
 * two files, and the one nobody remembered would go on showing the old
 * colours. So the entry got wider instead of the map getting duplicated.
 *
 * `argb` is exceljs's format: eight hex digits, alpha FIRST (FF = opaque).
 * Each one is the Tailwind `bg-*` shade of the same entry, so screen and sheet
 * are the same colour by construction and not by anyone keeping two lists in
 * step. The `border-*` and `text-*` shades have no spreadsheet equivalent and
 * are deliberately not represented.
 *
 * ANSWERING O-05 IS STILL EDITING THIS ONE OBJECT — that property is the whole
 * point of the constant and survives the change. Both renderings of an entry
 * move together, or the entry is wrong.
 */
export type MdrStatusColor = {
  /** Tailwind classes for the register's status badge. */
  classes: string
  /** exceljs solid-fill colour, AARRGGBB — the same shade as `classes`' bg-*. */
  argb: string
}

export const MDR_STATUS_COLORS: Record<string, MdrStatusColor> = {
  NOT_STARTED: { classes: 'border-slate-200 bg-slate-100 text-slate-700', argb: 'FFF1F5F9' },
  STARTED: { classes: 'border-sky-200 bg-sky-50 text-sky-800', argb: 'FFF0F9FF' },
  IDC: { classes: 'border-amber-200 bg-amber-50 text-amber-900', argb: 'FFFFFBEB' },
  IFR: { classes: 'border-indigo-200 bg-indigo-50 text-indigo-800', argb: 'FFEEF2FF' },
  RETCOM: { classes: 'border-orange-200 bg-orange-50 text-orange-900', argb: 'FFFFF7ED' },
  IFC: { classes: 'border-emerald-200 bg-emerald-50 text-emerald-800', argb: 'FFECFDF5' },
  IFI: { classes: 'border-teal-200 bg-teal-50 text-teal-800', argb: 'FFF0FDFA' },
  IFB: { classes: 'border-cyan-200 bg-cyan-50 text-cyan-900', argb: 'FFECFEFF' },
  VOID: { classes: 'border-red-200 bg-red-50 text-red-800', argb: 'FFFEF2F2' },
}

/**
 * The colour for an unknown, inactive or missing status code.
 *
 * It has to exist and it has to be reachable: a DC can add a workflow_status
 * row from /admin/dictionaries without a deploy, and the register must render
 * that document rather than crash on it. Same for a NULL — v_mdr LEFT JOINs
 * the dictionaries, so a status row hidden by a future policy yields NULL here
 * instead of dropping the document.
 *
 * The export uses this same fallback, so a status the screen renders neutral
 * is neutral in the sheet too — white, which is what an unfilled cell already
 * looks like.
 */
export const MDR_STATUS_COLOR_FALLBACK: MdrStatusColor = {
  classes: 'border-slate-200 bg-white text-slate-600',
  argb: 'FFFFFFFF',
}

/** Both renderings of one workflow_status code. Never throws; see the fallback above. */
export function mdrStatusColorEntry(code: string | null | undefined): MdrStatusColor {
  if (!code) return MDR_STATUS_COLOR_FALLBACK
  return MDR_STATUS_COLORS[code] ?? MDR_STATUS_COLOR_FALLBACK
}

/** Tailwind classes for one workflow_status code — what the register's badge uses. */
export function mdrStatusColor(code: string | null | undefined): string {
  return mdrStatusColorEntry(code).classes
}

/** The same colour as an exceljs AARRGGBB fill — what the export's status cell uses. */
export function mdrStatusFill(code: string | null | undefined): string {
  return mdrStatusColorEntry(code).argb
}

// ---------------------------------------------------------------------------
// Annex C — the column groups
// ---------------------------------------------------------------------------

/**
 * The register's columns, in the sheet's groups (annex C).
 *
 * This lives in a constant rather than in the page's JSX because the grouped
 * header is two rows that have to agree — a group spanning N columns above, N
 * column headings below — and two hand-written rows drift the moment anyone
 * adds a column. The page derives both from this.
 *
 * `key` is a column of dcs.v_mdr for every real column and null for the ones
 * with no source yet (the sixteen stage cells and WORKFLOW > Type), which
 * render empty. Keeping them here rather than dropping them is the point of
 * annex C: the DC reads the register across, and a missing group moves every
 * column they know.
 */
export type MdrColumn = {
  key: keyof MdrRow | null
  label: string
  /** Right-aligned numerics; the DC scans these down the column. */
  numeric?: boolean
}

export type MdrColumnGroup = {
  label: string
  columns: readonly MdrColumn[]
}

export const MDR_COLUMN_GROUPS: readonly MdrColumnGroup[] = [
  {
    label: 'DOCUMENT INFO',
    columns: [
      { key: 'process', label: 'Process' },
      { key: 'orig_code', label: 'Orig' },
      { key: 'doc_type_code', label: 'Type' },
      { key: 'seq', label: 'Seq' },
      { key: 'scl_doc_number', label: 'SCL Doc. Number' },
      { key: 'cpy_doc_number', label: 'Company Doc. Number' },
      { key: 'title', label: 'Title' },
      { key: 'doc_type_description', label: 'Type description' },
      { key: 'discipline_code', label: 'Discipline' },
      { key: 'ctr_code', label: 'CTR' },
      { key: 'budget_hours', label: 'Budget hours', numeric: true },
    ],
  },
  {
    label: 'STATUS',
    columns: [
      { key: 'cpy_revision', label: 'CPY Revision' },
      { key: 'scl_revision', label: 'SCL Revision' },
      { key: 'issue_date', label: 'Issue Date' },
      { key: 'workflow_status_code', label: 'Status' },
    ],
  },
  {
    label: 'WORKFLOW',
    columns: [
      // No source in the schema — see the migration header, decision 2.
      { key: 'workflow_type', label: 'Type' },
      { key: 'originator_id', label: 'Orig' },
      { key: 'checker_id', label: "Ch'd" },
      { key: 'approver_id', label: "App'd" },
    ],
  },
  // The four stage groups. Every cell is NULL until Phase 2 (tasks 2.12–2.14)
  // gives the view a source for them; the columns are here so the layout the
  // DC knows from the sheet does not change when they arrive.
  {
    label: 'IDC',
    columns: [
      { key: 'idc_planned', label: 'Planned' },
      { key: 'idc_forecast', label: 'Forecast' },
      { key: 'idc_actual', label: 'Actual' },
      { key: 'idc_revision', label: 'Rev' },
    ],
  },
  {
    label: 'IFR',
    columns: [
      { key: 'ifr_planned', label: 'Planned' },
      { key: 'ifr_forecast', label: 'Forecast' },
      { key: 'ifr_actual', label: 'Actual' },
      { key: 'ifr_revision', label: 'Rev' },
    ],
  },
  {
    label: 'RETCOM',
    columns: [
      { key: 'retcom_planned', label: 'Planned' },
      { key: 'retcom_forecast', label: 'Forecast' },
      { key: 'retcom_actual', label: 'Actual' },
      { key: 'retcom_revision', label: 'Rev' },
    ],
  },
  {
    label: 'IFC / IFI',
    columns: [
      { key: 'ifc_ifi_planned', label: 'Planned' },
      { key: 'ifc_ifi_forecast', label: 'Forecast' },
      { key: 'ifc_ifi_actual', label: 'Actual' },
      { key: 'ifc_ifi_revision', label: 'Rev' },
    ],
  },
] as const

/** Total column count — the colSpan an empty-state row has to fill. */
export const MDR_COLUMN_COUNT = MDR_COLUMN_GROUPS.reduce((n, g) => n + g.columns.length, 0)

// ---------------------------------------------------------------------------
// The frozen band
// ---------------------------------------------------------------------------

/**
 * The columns that stay put while the rest of the register scrolls.
 *
 * WHY THE BAND IS KEYED AND NOT COUNTED. The obvious spelling is "the first N
 * columns", and it is wrong in a way that says nothing when it breaks. The
 * value a Document Controller navigates by is the SCL document number, which
 * is the FIFTH column of the register — and 1b.06 adds a column picker, so
 * which column is fifth depends on what the reader has hidden. Hide `Seq` and
 * a band defined as positions 1..4 freezes `Company Doc. Number` instead of
 * the SCL number, pinning it against a width belonging to a column that is no
 * longer rendered. No exception, no failing request; the register just quietly
 * freezes the wrong thing. So the band is a list of KEYS, the offsets are
 * computed from the columns actually visible, and mdrFrozenBand() cannot
 * return a band that does not end on the anchor.
 *
 * WHY THESE FOUR. Freezing through the SCL number rather than only it is what
 * Excel's freeze panes does, and it keeps DOCUMENT INFO's group header as one
 * cell over one contiguous block. `Process` was in the band and came out
 * again: it is the widest of the four lead columns and the least useful
 * pinned, so it scrolls with everything else and the band drops under half the
 * scroll area at 1024px. Owner's decisions, 2026-09-19.
 */

/** Horizontal padding a register cell adds around its content — `p-2`, both sides. */
export const MDR_CELL_PADDING_PX = 16

/**
 * The column the band exists for. A band that does not end here is a bug, and
 * mdrFrozenBand() returns nothing rather than a band that does.
 */
export const MDR_FROZEN_ANCHOR_KEY = 'scl_doc_number'

/**
 * The band, in register order, with the content width each column is held to.
 *
 * The anchor carries `null` and is deliberately last: it is the only column in
 * the band with nothing pinned to its right-hand edge, so it is free to size
 * to its own content and can never be truncated — ORIG may be up to ten
 * characters and a project code may itself contain a hyphen (SCMS-IT). The
 * others cannot have that freedom, because each one's width is the next one's
 * offset; they carry `truncate`, which is safe precisely here, since Orig,
 * Type and Seq are the middle segments of the number the anchor prints in
 * full (SC2609-SCL-AA-0005-PL).
 *
 * Widths are sized from the HEADINGS, which are fixed strings, not from the
 * data, which is not: measured in a browser at text-xs, "Type" is 45px with
 * its sort icon, "Orig" 25px, "Seq" 23px.
 */
export const MDR_FROZEN_BAND: readonly { key: string; contentPx: number | null }[] = [
  { key: 'orig_code', contentPx: 36 },
  { key: 'doc_type_code', contentPx: 48 },
  { key: 'seq', contentPx: 36 },
  { key: MDR_FROZEN_ANCHOR_KEY, contentPx: null },
]

export type MdrFrozenColumn = {
  key: string
  /** Distance from the scroll container's left edge, in px. */
  left: number
  /** The width the column is held to, or null for the anchor. */
  contentPx: number | null
  /** The band's right-hand edge — the cell that carries the divider. */
  last: boolean
}

/**
 * The frozen band for one set of visible columns, offsets and all.
 *
 * Returns an EMPTY band when the anchor is not among them. That is not
 * defensive padding: freezing a band whose last column is not the SCL number
 * is the exact failure this function exists to make unreachable, and freezing
 * nothing is strictly better than freezing the wrong thing.
 */
export function mdrFrozenBand(visibleKeys: Iterable<string | null>): MdrFrozenColumn[] {
  const visible = new Set(visibleKeys)
  if (!visible.has(MDR_FROZEN_ANCHOR_KEY)) return []

  let left = 0
  const present = MDR_FROZEN_BAND.filter((column) => visible.has(column.key))
  return present.map((column, index) => {
    const frozen: MdrFrozenColumn = {
      key: column.key,
      left,
      contentPx: column.contentPx,
      last: index === present.length - 1,
    }
    // The anchor adds nothing to the running total — it is last, and nothing
    // is offset against it.
    if (column.contentPx !== null) left += column.contentPx + MDR_CELL_PADDING_PX
    return frozen
  })
}

// Column visibility (1b.06)
// ---------------------------------------------------------------------------

/**
 * Every column key, in annex-C order. The allowlist a `cols=` parameter is
 * checked against, and the order a saved view's column set is re-sorted into.
 *
 * Derived from MDR_COLUMN_GROUPS rather than written out, so a column added to
 * the register in Phase 2 becomes selectable without anyone remembering to add
 * it here. Every column in the groups has a key today; the filter is what
 * keeps this honest if a future layout-only column arrives with `key: null`.
 */
export const MDR_ALL_COLUMN_KEYS: readonly string[] = MDR_COLUMN_GROUPS.flatMap((group) =>
  group.columns.map((column) => column.key).filter((key): key is keyof MdrRow => key !== null),
)

/**
 * ONE COLUMN CAN NEVER BE HIDDEN: the SCL number.
 *
 * It is the document's identity and the only cell that links to the document
 * profile, so a register without it is a grid of attributes belonging to
 * nothing in particular — and an exported sheet without it cannot be matched
 * back to the register by the person reading it. Hiding everything else is the
 * user's business; this one is not offered, and a saved view that somehow
 * lacks it gets it back on restore (see normaliseColumnSelection).
 */
export const MDR_REQUIRED_COLUMN_KEY = 'scl_doc_number'

/**
 * The visible-column set, normalised: known keys only, annex-C order, the SCL
 * number always present.
 *
 * Empty in, empty out — and EMPTY MEANS EVERY COLUMN. That is not a special
 * case bolted on: it is what a register with no column choice made means, so
 * it is what the URL means when `cols` is absent, what dcs.user_views.columns
 * defaults to, and what a view saved before the picker existed says. Storing
 * "all 35 keys" instead would freeze today's column set into every saved view
 * and quietly hide Phase 2's new columns from anyone who had saved one.
 */
export function normaliseColumnSelection(raw: readonly string[]): string[] {
  const wanted = new Set(raw.filter((key) => MDR_ALL_COLUMN_KEYS.includes(key)))
  if (wanted.size === 0) return []
  wanted.add(MDR_REQUIRED_COLUMN_KEY)
  return MDR_ALL_COLUMN_KEYS.filter((key) => wanted.has(key))
}

/** True when this column is rendered. An empty selection shows everything. */
export function isColumnVisible(columns: readonly string[], key: keyof MdrRow | null): boolean {
  if (columns.length === 0) return true
  return key !== null && columns.includes(key)
}

/**
 * MDR_COLUMN_GROUPS narrowed to the visible columns, with groups that lost
 * every column dropped.
 *
 * THE SCREEN AND THE SHEET BOTH CALL THIS, and that is the only reason the
 * export can promise "the columns you are looking at". A second filter written
 * inline in either place would be a second answer to the same question. The
 * dropped-empty-group rule matters for the same reason: an annex-C group
 * header spanning zero columns is a broken table in HTML and a broken merge
 * range in xlsx.
 */
export function visibleColumnGroups(columns: readonly string[]): MdrColumnGroup[] {
  return MDR_COLUMN_GROUPS.map((group) => ({
    label: group.label,
    columns: group.columns.filter((column) => isColumnVisible(columns, column.key)),
  })).filter((group) => group.columns.length > 0)
}

/** Total columns across the given groups — the colSpan an empty-state row fills. */
export function columnCount(groups: readonly MdrColumnGroup[]): number {
  return groups.reduce((n, g) => n + g.columns.length, 0)
}

// ---------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------

/** dd.MM.yyyy — the format the sheet uses; the register is read, not parsed. */
export function formatMdrDate(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}.${m}.${y}` : value
}

/** Resolves a staffing id to a name. See the page's `person()` for why ids can survive. */
export type MdrNameResolver = (id: string | null) => string

/**
 * What one cell SAYS, for any column — the single answer the screen and the
 * export both use.
 *
 * The three columns the register renders as something other than text (the SCL
 * number's link, the status badge, the truncated title) still take their TEXT
 * from here; the page only wraps it. That is what makes "the export is what
 * you are looking at" a property of the code rather than a promise: there is
 * one function deciding what a cell says, and two renderings of its result.
 *
 * Returns a number for the numeric columns so the sheet can total them — a
 * budget-hours column of text strings is a column no DC can sum, which is most
 * of what they would open the file for.
 */
export function mdrCellValue(
  row: MdrRow,
  key: keyof MdrRow | null,
  nameFor: MdrNameResolver,
): string | number | null {
  if (key === null) return null

  if (key === 'workflow_status_code') return row.workflow_status_label ?? row.workflow_status_code ?? ''
  if (key === 'originator_id') return nameFor(row.originator_id)
  if (key === 'checker_id') return nameFor(row.checker_id)
  if (key === 'approver_id') return nameFor(row.approver_id)
  if (key === 'budget_hours') return row.budget_hours ?? null

  const value = row[key]
  return value === null || value === undefined ? '' : String(value)
}

// ---------------------------------------------------------------------------
// searchParams
// ---------------------------------------------------------------------------

/**
 * Columns the register may be sorted by — an ALLOWLIST, and it has to be one.
 *
 * The value reaches PostgREST's `order` parameter, so an unchecked string from
 * the URL would let a visitor sort by any column of the view, including
 * search_text. Anything not in this list falls back to the default rather than
 * being passed through.
 */
export const MDR_SORT_COLUMNS = [
  'scl_doc_number',
  'cpy_doc_number',
  'title',
  'doc_type_code',
  'discipline_code',
  'workflow_status_code',
  'issue_date',
  'budget_hours',
  'created_at',
] as const
export type MdrSortColumn = (typeof MDR_SORT_COLUMNS)[number]

/** The register opens on document number ascending — the order the sheet is kept in. */
export const MDR_DEFAULT_SORT: MdrSortColumn = 'scl_doc_number'
export const MDR_PAGE_SIZE = 50

export type MdrQuery = {
  projectId: string | null
  docTypeId: string | null
  originatorId: string | null
  workflowStatusId: string | null
  disciplineId: string | null
  search: string
  sort: MdrSortColumn
  ascending: boolean
  page: number
  /**
   * Visible column keys, annex-C order. EMPTY MEANS EVERY COLUMN (1b.06).
   *
   * Part of MdrQuery rather than a separate piece of state because a saved
   * view is one object, the URL is one string, and the export takes one
   * argument. Splitting "what to show" from "which rows" would mean three
   * places deciding to keep them together.
   */
  columns: string[]
}

/** Next.js hands searchParams as string | string[] | undefined; take the first value. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function uuidOrNull(value: string | string[] | undefined): string | null {
  const v = one(value)
  return UUID_RE.test(v) ? v : null
}

export type RawSearchParams = Record<string, string | string[] | undefined>

/**
 * Turns the URL into the query the register runs. Total: every malformed value
 * becomes the default rather than an error, because a register that refuses to
 * render because someone hand-edited `?page=banana` is worse than one that
 * shows page 1.
 */
export function parseMdrSearchParams(raw: RawSearchParams): MdrQuery {
  const sortRaw = one(raw.sort)
  const sort = (MDR_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as MdrSortColumn)
    : MDR_DEFAULT_SORT

  const pageRaw = Number(one(raw.page))
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1

  return {
    projectId: uuidOrNull(raw.project),
    docTypeId: uuidOrNull(raw.type),
    originatorId: uuidOrNull(raw.orig),
    workflowStatusId: uuidOrNull(raw.status),
    disciplineId: uuidOrNull(raw.discipline),
    search: one(raw.q),
    sort,
    // Descending only when explicitly asked for; anything else is ascending.
    ascending: one(raw.dir) !== 'desc',
    page,
    // Unknown keys are dropped rather than rejected, like every other value
    // here: `?cols=banana` shows the whole register, not an error page.
    columns: normaliseColumnSelection(one(raw.cols).split(',').map((key) => key.trim())),
  }
}

/**
 * Rebuilds the query string for a link that changes one thing.
 *
 * Every filter control and every sortable heading is a plain <a>, so the whole
 * screen works as a server component with no client-side state — and a
 * filtered register stays a URL the DC can bookmark and send to someone.
 * Changing a filter resets to page 1: staying on page 7 of a result set that
 * now has two pages shows an empty table and looks like a bug.
 */
export function mdrHref(current: MdrQuery, change: Partial<MdrQuery>): string {
  const next = { ...current, ...change }
  const params = new URLSearchParams()

  if (next.projectId) params.set('project', next.projectId)
  if (next.docTypeId) params.set('type', next.docTypeId)
  if (next.originatorId) params.set('orig', next.originatorId)
  if (next.workflowStatusId) params.set('status', next.workflowStatusId)
  if (next.disciplineId) params.set('discipline', next.disciplineId)
  if (next.search) params.set('q', next.search)
  if (next.sort !== MDR_DEFAULT_SORT) params.set('sort', next.sort)
  if (!next.ascending) params.set('dir', 'desc')
  // Normalised here as well as in the parser, because this is the SERIALISER:
  // a caller passing `{ columns: ['title'] }` must produce the same URL the
  // parser would produce reading it back, or a link and the page it leads to
  // disagree about what is on screen. Absent when every column is shown — the
  // common case, and a `cols=` listing all 35 keys in every link would make
  // the register's URLs unshareable in practice.
  const columns = normaliseColumnSelection(next.columns)
  if (columns.length > 0) params.set('cols', columns.join(','))

  const page = 'page' in change ? next.page : 1
  if (page > 1) params.set('page', String(page))

  const qs = params.toString()
  return qs ? `/mdr?${qs}` : '/mdr'
}

/** True when any filter or search is active — the "Clear filters" affordance. */
export function hasActiveFilters(query: MdrQuery): boolean {
  return Boolean(
    query.projectId ||
      query.docTypeId ||
      query.originatorId ||
      query.workflowStatusId ||
      query.disciplineId ||
      query.search,
  )
}

/**
 * Escapes a user's search term for a PostgREST `ilike` filter.
 *
 * `%` and `_` are LIKE wildcards and PostgREST exposes no ESCAPE clause, so a
 * term containing one cannot be matched literally. Both are stripped rather
 * than passed through: left in, `%` turns "50%" into a term that matches every
 * row in the register, which reads as the filter being broken. Stripping makes
 * "50%" search for "50", a superset of what was asked — wrong in the harmless
 * direction. A backslash goes for the same reason.
 *
 * Commas, dots and parentheses are NOT touched: they are PostgREST *syntax*
 * characters, and supabase-js already quotes the value for us. Stripping them
 * would break searching for a title with a comma in it, which is most titles.
 */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[%_\\]/g, '')
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * The columns the table renders, as ONE string literal.
 *
 * One literal because supabase-js parses the select at the type level: a
 * string built with `+` or a template degrades to `string` and every column
 * comes back as GenericStringError (the lesson lib/documents.ts paid a compile
 * error for). Do not "tidy" this into concatenated lines.
 *
 * search_text is deliberately ABSENT. The query FILTERS on it — that is the
 * whole reason the view exposes it — but never selects it, so the three
 * concatenated fields do not travel over the wire once per row.
 */
const MDR_SELECT =
  'approver_id, area_code, area_id, area_label, budget_hours, checker_id, cpy_doc_number, cpy_revision, created_at, ctr_code, ctr_description, discipline_code, discipline_id, discipline_label, doc_type_code, doc_type_description, doc_type_id, document_id, idc_actual, idc_forecast, idc_planned, idc_revision, ifc_ifi_actual, ifc_ifi_forecast, ifc_ifi_planned, ifc_ifi_revision, ifr_actual, ifr_forecast, ifr_planned, ifr_revision, issue_date, language_code, language_id, orig_code, originator_id, process, project_code, project_id, project_name, retcom_actual, retcom_forecast, retcom_planned, retcom_revision, scl_doc_number, scl_revision, seq, title, updated_at, workflow_status_code, workflow_status_id, workflow_status_label, workflow_type'

export type MdrPage = {
  rows: MdrRow[]
  /** Total matching rows BEFORE paging — from PostgREST's exact count, not rows.length. */
  total: number
  page: number
  pageCount: number
}

/**
 * One page of the register: ONE query, filtered, searched, sorted and paged by
 * Postgres.
 *
 * Which rows come back is decided by "Project members read documents" (RLS)
 * through dcs.v_mdr's security_invoker — NOT by anything here. Note what that
 * means for the project filter below: `.eq('project_id', …)` is scoping, not
 * access control. Dropping it would not show anyone a project they may not
 * read; it would show them all of their own. The RLS proof for the view is the
 * bare, filter-free count in supabase/tests/mdr_register_view.test.sql
 * section 8.
 */
/**
 * Every filter, the search and the ordering — applied to a query that has
 * already chosen its select and its count mode.
 *
 * THIS FUNCTION IS WHY THE EXPORT CANNOT DRIFT FROM THE SCREEN (1b.06).
 * listMdrPage() and listMdrAll() differ in exactly one thing — how much they
 * take — and share everything that decides WHICH rows and in WHAT ORDER. A
 * second copy of these seven lines in the export module is precisely the bug
 * this task exists to prevent: it would pass every test on the day it was
 * written and diverge the first time a filter was added to the screen.
 *
 * Generic over the builder type rather than typed as one: supabase-js's
 * filter builders are a chain of distinct types and naming one of them here
 * would pin this to whichever call site was written first.
 */
function applyMdrQuery<T extends {
  eq: (column: string, value: string) => T
  ilike: (column: string, pattern: string) => T
  order: (column: string, options: { ascending: boolean; nullsFirst: boolean }) => T
}>(request: T, query: MdrQuery): T {
  let next = request

  if (query.projectId) next = next.eq('project_id', query.projectId)
  if (query.docTypeId) next = next.eq('doc_type_id', query.docTypeId)
  if (query.originatorId) next = next.eq('originator_id', query.originatorId)
  if (query.workflowStatusId) next = next.eq('workflow_status_id', query.workflowStatusId)
  if (query.disciplineId) next = next.eq('discipline_id', query.disciplineId)

  // The combined search: one predicate over scl_doc_number + cpy_doc_number +
  // title, served by documents_search_idx. It is ONE .ilike() on the view's
  // search_text column rather than three .or()-ed ilikes precisely so the
  // planner can use that index — see the column's comment in the migration.
  const term = escapeSearchTerm(query.search)
  if (term) next = next.ilike('search_text', `%${term}%`)

  // nullsFirst: false so the documents that have a value sort to the top of an
  // ascending sort. Most of these columns are NULL for most rows today (the
  // whole STATUS group is), and a page of empty cells above the real ones is a
  // register that looks broken.
  next = next.order(query.sort, { ascending: query.ascending, nullsFirst: false })

  // A stable tiebreaker. Without one, two rows equal on the sort column may
  // come back in a different order on every request, so paging can show the
  // same document twice and never show another — Postgres gives no ordering
  // guarantee beyond the ORDER BY, and the register is read page by page.
  // The export needs it for a second reason: it reads the result in chunks
  // (see listMdrAll), and an unstable order there would duplicate and drop
  // rows across chunk boundaries rather than merely shuffle a page.
  if (query.sort !== 'scl_doc_number') {
    next = next.order('scl_doc_number', { ascending: true, nullsFirst: false })
  }

  return next
}

export async function listMdrPage(supabase: DbClient, query: MdrQuery): Promise<MdrPage> {
  let request = applyMdrQuery(
    supabase.schema('dcs').from('v_mdr').select(MDR_SELECT, { count: 'exact' }),
    query,
  )

  const from = (query.page - 1) * MDR_PAGE_SIZE
  request = request.range(from, from + MDR_PAGE_SIZE - 1)

  const { data, error, count } = await request
  if (error) throw new Error(`listMdrPage: ${error.message}`)

  const total = count ?? 0
  return {
    rows: data ?? [],
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / MDR_PAGE_SIZE)),
  }
}

/**
 * How many rows one export request asks for.
 *
 * Deliberately below `max_rows` in supabase/config.toml, which is 1000 (read
 * 2026-09-19). That setting is a HARD CEILING PostgREST applies silently: ask
 * for 5000 rows and you get 1000 and no error, no warning, and an export that
 * is wrong in the one way this task must not be wrong. Chunking under the
 * ceiling is how the export stays correct without depending on a server
 * setting that lives outside this repo for remotes.
 */
const MDR_EXPORT_CHUNK = 500

/**
 * A hard stop, so a filter that matches the whole register cannot turn one
 * click into an unbounded read. 20 000 rows is ~140x the 146 documents the
 * 1b.13 import brings, and a sheet larger than this is a data extract, not
 * "what I see on screen". Reaching it is reported (see MdrExportRows.truncated)
 * rather than swallowed: a silently short export is the failure mode the whole
 * fidelity criterion exists to rule out.
 */
export const MDR_EXPORT_MAX_ROWS = 20_000

export type MdrExportRows = {
  rows: MdrRow[]
  /** True when MDR_EXPORT_MAX_ROWS was hit and the sheet is NOT the whole result. */
  truncated: boolean
}

/**
 * EVERY row matching the filters, in the register's order — the export's read.
 *
 * Not `listMdrPage` with a big page size, and not a separate query: the same
 * applyMdrQuery() the screen uses decides the rows and the order, and the only
 * difference is that paging is replaced by reading the whole result in chunks.
 * That is the invariant acceptance criterion 1 checks, and the reason the two
 * cannot disagree is structural rather than a matter of keeping two functions
 * in step.
 *
 * `query.page` is deliberately IGNORED. The export is the whole filtered
 * register, not the page the user happens to be standing on — decided with the
 * owner, 2026-09-19. The button says so.
 */
export async function listMdrAll(supabase: DbClient, query: MdrQuery): Promise<MdrExportRows> {
  const rows: MdrRow[] = []

  for (let from = 0; from < MDR_EXPORT_MAX_ROWS; from += MDR_EXPORT_CHUNK) {
    const request = applyMdrQuery(
      supabase.schema('dcs').from('v_mdr').select(MDR_SELECT),
      query,
    ).range(from, from + MDR_EXPORT_CHUNK - 1)

    const { data, error } = await request
    if (error) throw new Error(`listMdrAll: ${error.message}`)

    const chunk = data ?? []
    rows.push(...chunk)

    // A short chunk means the result is exhausted. Checking the length rather
    // than an exact count avoids a second query for `count: 'exact'`, which on
    // this view is a full scan of everything RLS lets the caller read.
    if (chunk.length < MDR_EXPORT_CHUNK) return { rows, truncated: false }
  }

  return { rows, truncated: true }
}

/**
 * The projects offered in the register's project filter.
 *
 * Reads public.projects, which every authenticated user may read — so this is
 * a list of projects, not a list of projects whose documents the caller can
 * see. That asymmetry is deliberate and harmless: picking a project the caller
 * has no role on filters the register down to the zero rows RLS was already
 * returning for it. Hiding them would need a second query per project and
 * would still not be an access decision.
 */
export async function getMdrProjectOptions(supabase: DbClient) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, project_code')
    .order('project_code', { ascending: true })
  if (error) throw new Error(`getMdrProjectOptions: ${error.message}`)
  return data ?? []
}
