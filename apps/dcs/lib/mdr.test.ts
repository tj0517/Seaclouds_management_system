// DCS 1b.05. Unit tests for the MDR register's decisions — the ones that run
// before any database is involved, plus the shape of the query it issues.
//
// The database half is proven against Postgres in
// supabase/tests/mdr_register_view.test.sql: the view's columns, the
// security_invoker RLS behaviour, the combined search, and the query plan.
// These cover what that file cannot see — how the URL becomes a query, and
// that the page does its filtering in SQL rather than in JavaScript.
import { describe, expect, it } from 'vitest'
import {
  MDR_ALL_COLUMN_KEYS,
  MDR_CELL_PADDING_PX,
  MDR_COLUMN_COUNT,
  MDR_COLUMN_GROUPS,
  MDR_DEFAULT_SORT,
  MDR_FROZEN_ANCHOR_KEY,
  MDR_FROZEN_BAND,
  MDR_PAGE_SIZE,
  MDR_STATUS_COLORS,
  MDR_STATUS_COLOR_FALLBACK,
  MDR_REQUIRED_COLUMN_KEY,
  columnCount,
  escapeSearchTerm,
  hasActiveFilters,
  isColumnVisible,
  listMdrAll,
  listMdrPage,
  mdrFrozenBand,
  mdrHref,
  mdrStatusColor,
  mdrStatusFill,
  normaliseColumnSelection,
  parseMdrSearchParams,
  visibleColumnGroups,
} from './mdr'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TYPE = '22222222-2222-4222-8222-222222222222'
const ORIG = '33333333-3333-4333-8333-333333333333'
const STATUS = '44444444-4444-4444-8444-444444444444'
const DISCIPLINE = '55555555-5555-4555-8555-555555555555'

// ---------------------------------------------------------------------------
// Status colours — the provisional palette and, more importantly, its fallback
// ---------------------------------------------------------------------------

describe('mdrStatusColor', () => {
  // The nine seeded workflow_status codes, read from scl-dev 2026-09-19. If a
  // migration adds a tenth, this fails and someone has to decide its colour
  // rather than let it silently fall back to grey.
  const SEEDED = [
    'NOT_STARTED',
    'STARTED',
    'IDC',
    'IFR',
    'RETCOM',
    'IFC',
    'IFI',
    'IFB',
    'VOID',
  ]

  it('maps every one of the nine seeded workflow_status codes', () => {
    for (const code of SEEDED) {
      expect(MDR_STATUS_COLORS[code]?.classes, code).toBeTypeOf('string')
      expect(mdrStatusColor(code)).not.toBe(MDR_STATUS_COLOR_FALLBACK.classes)
    }
    expect(Object.keys(MDR_STATUS_COLORS).sort()).toEqual([...SEEDED].sort())
  })

  // Red proof 3 from the task's verification list. A DC can add a
  // workflow_status row from /admin/dictionaries without a deploy, and the
  // register has to render that document rather than throw.
  it('falls back to a neutral palette for an unknown code instead of throwing', () => {
    expect(() => mdrStatusColor('SOMETHING_A_DC_ADDED')).not.toThrow()
    expect(mdrStatusColor('SOMETHING_A_DC_ADDED')).toBe(MDR_STATUS_COLOR_FALLBACK.classes)
  })

  it('falls back for null and undefined too — v_mdr LEFT JOINs the dictionary', () => {
    expect(mdrStatusColor(null)).toBe(MDR_STATUS_COLOR_FALLBACK.classes)
    expect(mdrStatusColor(undefined)).toBe(MDR_STATUS_COLOR_FALLBACK.classes)
    expect(mdrStatusColor('')).toBe(MDR_STATUS_COLOR_FALLBACK.classes)
  })

  // The whole point of keeping the palette in one constant (O-05 is open).
  it('never reaches outside MDR_STATUS_COLORS for a colour', () => {
    const knownClasses = new Set(Object.values(MDR_STATUS_COLORS).map((c) => c.classes))
    for (const code of SEEDED) expect(knownClasses.has(mdrStatusColor(code))).toBe(true)
  })

  // 1b.06: the same constant now answers for the .xlsx too. These three are
  // what stop the export growing a palette of its own — the failure mode is
  // not a crash but O-05 being answered in lib/mdr.ts while the sheet quietly
  // keeps the old colours.
  it('gives every status an exceljs ARGB fill from the same entry as its classes', () => {
    const knownFills = new Set(Object.values(MDR_STATUS_COLORS).map((c) => c.argb))
    for (const code of SEEDED) {
      expect(mdrStatusFill(code)).toMatch(/^FF[0-9A-F]{6}$/)
      expect(knownFills.has(mdrStatusFill(code))).toBe(true)
    }
  })

  it('falls back to the neutral fill for an unknown, null or empty code', () => {
    expect(mdrStatusFill('SOMETHING_A_DC_ADDED')).toBe(MDR_STATUS_COLOR_FALLBACK.argb)
    expect(mdrStatusFill(null)).toBe(MDR_STATUS_COLOR_FALLBACK.argb)
    expect(mdrStatusFill('')).toBe(MDR_STATUS_COLOR_FALLBACK.argb)
  })

  it('keeps the two renderings of a status in the same entry, so O-05 is one edit', () => {
    // Not a style check: if an entry ever gains a class without a fill (or the
    // reverse), one of the two consumers silently shows last month's colour.
    for (const [code, colour] of Object.entries(MDR_STATUS_COLORS)) {
      expect(colour.classes, code).toMatch(/\bbg-/)
      expect(colour.argb, code).toMatch(/^FF[0-9A-F]{6}$/)
    }
  })
})

// ---------------------------------------------------------------------------
// Annex C column groups
// ---------------------------------------------------------------------------

describe('MDR_COLUMN_GROUPS', () => {
  it('carries the seven annex-C groups in the sheet order', () => {
    expect(MDR_COLUMN_GROUPS.map((g) => g.label)).toEqual([
      'DOCUMENT INFO',
      'STATUS',
      'WORKFLOW',
      'IDC',
      'IFR',
      'RETCOM',
      'IFC / IFI',
    ])
  })

  it('carries annex C DOCUMENT INFO column for column', () => {
    expect(MDR_COLUMN_GROUPS[0].columns.map((c) => c.label)).toEqual([
      'Process',
      'Orig',
      'Type',
      'Seq',
      'SCL Doc. Number',
      'Company Doc. Number',
      'Title',
      'Type description',
      'Discipline',
      'CTR',
      'Budget hours',
    ])
  })

  it('gives each of the four stage groups Planned / Forecast / Actual / Rev', () => {
    for (const group of MDR_COLUMN_GROUPS.slice(3)) {
      expect(group.columns.map((c) => c.label), group.label).toEqual([
        'Planned',
        'Forecast',
        'Actual',
        'Rev',
      ])
    }
  })

  it('counts its own columns, so an empty-state colSpan cannot drift', () => {
    expect(MDR_COLUMN_COUNT).toBe(
      MDR_COLUMN_GROUPS.reduce((n, g) => n + g.columns.length, 0),
    )
    expect(MDR_COLUMN_COUNT).toBe(11 + 4 + 4 + 4 * 4)
  })
})

// ---------------------------------------------------------------------------
// The frozen band
// ---------------------------------------------------------------------------

// WHAT THESE TESTS CANNOT DO, said here rather than implied: none of them
// proves the column is visually pinned. That needs a layout engine — whether
// a cell stays put is decided by Chromium, not by this module, and a unit
// test asserting it would be asserting its own arithmetic. The visual proof
// for this change is the in-browser measurements in the PR body (SCL header
// at a constant distance from the container's left edge at scroll 0, 50% and
// 100%).
//
// What they DO cover are the two failures that are silent AND look right in a
// screenshot taken with today's columns: the offset ladder drifting from the
// widths it is the running total of, and — the one that only appears once
// 1b.06's column picker exists — the band ending somewhere other than the SCL
// number because a column before it was hidden.

/** Every column key the register can render, which is what the page passes in. */
const ALL_KEYS = MDR_COLUMN_GROUPS.flatMap((group) => group.columns.map((column) => column.key))

describe('mdrFrozenBand', () => {
  it('ends on the anchor for EVERY subset of visible columns', () => {
    // The whole point of keying the band. Exhaustive over the band's own
    // columns, because those are the ones whose absence moves the anchor: with
    // positional slicing, hiding `Seq` pins `Company Doc. Number` instead.
    const optional = MDR_FROZEN_BAND.filter((c) => c.key !== MDR_FROZEN_ANCHOR_KEY).map((c) => c.key)
    for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
      const hidden = optional.filter((_, i) => (mask >> i) & 1)
      const visible = ALL_KEYS.filter((key) => !hidden.includes(key as string))
      const band = mdrFrozenBand(visible)
      expect(band.length, `hiding ${hidden.join(', ') || 'nothing'}`).toBeGreaterThan(0)
      expect(band[band.length - 1].key, `hiding ${hidden.join(', ') || 'nothing'}`).toBe(
        MDR_FROZEN_ANCHOR_KEY,
      )
      expect(band.filter((c) => c.last)).toHaveLength(1)
    }
  })

  it('offsets each column by the running total of the widths actually rendered', () => {
    const band = mdrFrozenBand(ALL_KEYS)
    expect(band[0].left).toBe(0)
    for (let i = 1; i < band.length; i += 1) {
      expect(band[i].left, `offset ${i}`).toBe(
        band[i - 1].left + (band[i - 1].contentPx ?? 0) + MDR_CELL_PADDING_PX,
      )
    }
  })

  it('closes the gap when a band column is hidden, rather than leaving a hole', () => {
    // A ladder computed from the FULL band would leave `scl_doc_number` one
    // slot too far right and a dead 52px where `Type` used to be.
    const withoutType = mdrFrozenBand(ALL_KEYS.filter((key) => key !== 'doc_type_code'))
    expect(withoutType.map((c) => c.key)).toEqual(['orig_code', 'seq', MDR_FROZEN_ANCHOR_KEY])
    expect(withoutType.map((c) => c.left)).toEqual([0, 36 + MDR_CELL_PADDING_PX, 36 + 36 + 2 * MDR_CELL_PADDING_PX])
  })

  it('freezes nothing at all when the anchor itself is hidden', () => {
    // Strictly better than freezing the wrong columns: the register scrolls
    // as it did before this change, which is a known state.
    expect(mdrFrozenBand(ALL_KEYS.filter((key) => key !== MDR_FROZEN_ANCHOR_KEY))).toEqual([])
  })

  it('declares a width for every band column except the anchor', () => {
    // The anchor is free to grow so a long SCL number is never truncated; it
    // can be, because nothing is pinned to its right-hand edge.
    for (const column of MDR_FROZEN_BAND) {
      if (column.key === MDR_FROZEN_ANCHOR_KEY) expect(column.contentPx).toBeNull()
      else expect(column.contentPx, column.key).toBeGreaterThan(0)
    }
    expect(MDR_FROZEN_BAND[MDR_FROZEN_BAND.length - 1].key).toBe(MDR_FROZEN_ANCHOR_KEY)
  })

  it('is contiguous inside DOCUMENT INFO, which the group header split assumes', () => {
    const positions = MDR_FROZEN_BAND.map((c) =>
      MDR_COLUMN_GROUPS[0].columns.findIndex((column) => column.key === c.key),
    )
    expect(positions.every((p) => p >= 0)).toBe(true)
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBe(positions[i - 1] + 1)
    }
    // Leaves at least one DOCUMENT INFO column outside, or the trailing
    // header cell would be a colSpan of zero.
    expect(MDR_FROZEN_BAND.length).toBeLessThan(MDR_COLUMN_GROUPS[0].columns.length)
  })
})

// ---------------------------------------------------------------------------
// searchParams
// ---------------------------------------------------------------------------

describe('parseMdrSearchParams', () => {
  it('defaults to the whole register, number ascending, page 1', () => {
    expect(parseMdrSearchParams({})).toEqual({
      projectId: null,
      docTypeId: null,
      originatorId: null,
      workflowStatusId: null,
      disciplineId: null,
      search: '',
      sort: MDR_DEFAULT_SORT,
      ascending: true,
      page: 1,
      // 1b.06: empty means EVERY column, not "no columns" — see
      // normaliseColumnSelection. A bare /mdr shows the whole annex-C layout.
      columns: [],
    })
  })

  it('reads all five filters and the search term', () => {
    const query = parseMdrSearchParams({
      project: PROJECT,
      type: TYPE,
      orig: ORIG,
      status: STATUS,
      discipline: DISCIPLINE,
      q: '  survey report  ',
    })
    expect(query.projectId).toBe(PROJECT)
    expect(query.docTypeId).toBe(TYPE)
    expect(query.originatorId).toBe(ORIG)
    expect(query.workflowStatusId).toBe(STATUS)
    expect(query.disciplineId).toBe(DISCIPLINE)
    expect(query.search).toBe('survey report')
  })

  // The GET form submits every select, including the ones left on "All".
  it('treats an empty filter value as no filter (the form always submits one)', () => {
    const query = parseMdrSearchParams({ project: '', type: '', orig: '', status: '', discipline: '' })
    expect(query.projectId).toBeNull()
    expect(query.docTypeId).toBeNull()
  })

  it('drops a filter value that is not a uuid rather than passing it to PostgREST', () => {
    const query = parseMdrSearchParams({ project: "'; drop table documents; --", type: '42' })
    expect(query.projectId).toBeNull()
    expect(query.docTypeId).toBeNull()
  })

  // The allowlist. This value reaches PostgREST's `order` parameter.
  it('accepts only an allowlisted sort column', () => {
    expect(parseMdrSearchParams({ sort: 'title' }).sort).toBe('title')
    expect(parseMdrSearchParams({ sort: 'search_text' }).sort).toBe(MDR_DEFAULT_SORT)
    expect(parseMdrSearchParams({ sort: 'budget_hours; drop table' }).sort).toBe(MDR_DEFAULT_SORT)
  })

  it('sorts descending only when explicitly asked', () => {
    expect(parseMdrSearchParams({ dir: 'desc' }).ascending).toBe(false)
    expect(parseMdrSearchParams({ dir: 'asc' }).ascending).toBe(true)
    expect(parseMdrSearchParams({ dir: 'sideways' }).ascending).toBe(true)
  })

  it('falls back to page 1 for every unusable page value rather than erroring', () => {
    expect(parseMdrSearchParams({ page: '7' }).page).toBe(7)
    expect(parseMdrSearchParams({ page: 'banana' }).page).toBe(1)
    expect(parseMdrSearchParams({ page: '0' }).page).toBe(1)
    expect(parseMdrSearchParams({ page: '-3' }).page).toBe(1)
    expect(parseMdrSearchParams({ page: '1.5' }).page).toBe(1)
  })

  it('takes the first value when a param is repeated', () => {
    expect(parseMdrSearchParams({ project: [PROJECT, TYPE] }).projectId).toBe(PROJECT)
  })
})

describe('hasActiveFilters', () => {
  it('is false for the untouched register and true for any single filter', () => {
    expect(hasActiveFilters(parseMdrSearchParams({}))).toBe(false)
    expect(hasActiveFilters(parseMdrSearchParams({ q: 'x' }))).toBe(true)
    expect(hasActiveFilters(parseMdrSearchParams({ project: PROJECT }))).toBe(true)
    // Sorting and paging are not filters — "Clear" must not appear for them.
    expect(hasActiveFilters(parseMdrSearchParams({ sort: 'title', page: '3' }))).toBe(false)
  })
})

describe('mdrHref', () => {
  it('omits every default, so an untouched register is a clean /mdr', () => {
    expect(mdrHref(parseMdrSearchParams({}), {})).toBe('/mdr')
  })

  it('keeps the filters when only the sort changes', () => {
    const query = parseMdrSearchParams({ project: PROJECT, q: 'survey' })
    const href = mdrHref(query, { sort: 'title', ascending: false })
    expect(href).toContain(`project=${PROJECT}`)
    expect(href).toContain('q=survey')
    expect(href).toContain('sort=title')
    expect(href).toContain('dir=desc')
  })

  // Page 7 of a result set that now has two pages renders an empty table and
  // reads as a bug, so any change that is not itself a page change resets it.
  it('resets to page 1 when anything but the page changes', () => {
    const query = parseMdrSearchParams({ page: '7', project: PROJECT })
    expect(mdrHref(query, { sort: 'title' })).not.toContain('page=')
    expect(mdrHref(query, { search: 'x' })).not.toContain('page=')
  })

  it('keeps the page when the page is what changed', () => {
    const query = parseMdrSearchParams({ page: '7', project: PROJECT })
    expect(mdrHref(query, { page: 8 })).toContain('page=8')
    expect(mdrHref(query, { page: 1 })).not.toContain('page=')
  })
})

describe('escapeSearchTerm', () => {
  // % left in would make "50%" match every row in the register, which reads as
  // the filter being broken. Stripping searches for "50" — a superset.
  it('strips LIKE wildcards, which PostgREST gives no way to escape', () => {
    expect(escapeSearchTerm('50%')).toBe('50')
    expect(escapeSearchTerm('SCMS_TEST')).toBe('SCMSTEST')
    expect(escapeSearchTerm('a\\b')).toBe('ab')
  })

  it('leaves the punctuation that appears in real titles and numbers alone', () => {
    expect(escapeSearchTerm('SC2699-SCL-AA-0001-PL')).toBe('SC2699-SCL-AA-0001-PL')
    expect(escapeSearchTerm('Survey report, Baltic Sea (rev. A)')).toBe(
      'Survey report, Baltic Sea (rev. A)',
    )
  })
})

// ---------------------------------------------------------------------------
// The query itself — one round trip, everything pushed into SQL
// ---------------------------------------------------------------------------

/**
 * Records every PostgREST call listMdrPage makes.
 *
 * The assertions below are about what was sent, not about what came back: the
 * acceptance criterion is that the register filters, searches, sorts and pages
 * in SQL, and the only way to show that from a unit test is to prove the page
 * asked the database to do it — and never touched the returned array.
 */
function stubClient(rows: unknown[], count: number) {
  const calls: { method: string; args: unknown[] }[] = []
  let schemaCount = 0
  let fromCount = 0
  const relations: string[] = []

  const request: Record<string, unknown> = {
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null, count }).then(onOk, onErr),
  }
  for (const method of ['select', 'eq', 'ilike', 'order', 'range', 'or', 'in', 'limit']) {
    request[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return request
    }
  }

  const client = {
    schema: (name: string) => {
      schemaCount += 1
      if (name !== 'dcs') throw new Error(`unexpected schema(${name})`)
      return {
        from: (relation: string) => {
          fromCount += 1
          relations.push(relation)
          return request
        },
      }
    },
  }

  return {
    client: client as never,
    calls,
    get schemaCount() {
      return schemaCount
    },
    get fromCount() {
      return fromCount
    },
    relations,
  }
}

const ROW = { document_id: 'd1', scl_doc_number: 'SC2699-SCL-AA-0001-PL' }

describe('listMdrPage', () => {
  it('issues exactly ONE query against dcs.v_mdr', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(stub.client, parseMdrSearchParams({}))
    expect(stub.fromCount).toBe(1)
    expect(stub.relations).toEqual(['v_mdr'])
  })

  it('asks Postgres for the exact total, rather than counting the rows it got back', async () => {
    const stub = stubClient([ROW], 137)
    const page = await listMdrPage(stub.client, parseMdrSearchParams({}))
    // 137 matching rows, 1 row on this page: a JS count would say 1 and the
    // pager would show a single page over a register of 137 documents.
    expect(page.total).toBe(137)
    expect(page.pageCount).toBe(Math.ceil(137 / MDR_PAGE_SIZE))
    const select = stub.calls.find((c) => c.method === 'select')
    expect(select?.args[1]).toEqual({ count: 'exact' })
  })

  it('pushes all five filters into the query as .eq() on the right columns', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(
      stub.client,
      parseMdrSearchParams({
        project: PROJECT,
        type: TYPE,
        orig: ORIG,
        status: STATUS,
        discipline: DISCIPLINE,
      }),
    )
    const eqs = stub.calls.filter((c) => c.method === 'eq').map((c) => c.args)
    expect(eqs).toEqual([
      ['project_id', PROJECT],
      ['doc_type_id', TYPE],
      ['originator_id', ORIG],
      ['workflow_status_id', STATUS],
      ['discipline_id', DISCIPLINE],
    ])
  })

  it('sends no filter at all when none is set', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(stub.client, parseMdrSearchParams({}))
    expect(stub.calls.filter((c) => c.method === 'eq')).toHaveLength(0)
    expect(stub.calls.filter((c) => c.method === 'ilike')).toHaveLength(0)
  })

  // The combined search is ONE predicate on the view's search_text column, not
  // three OR-ed ilikes: only the single concatenated form matches the
  // expression documents_search_idx is built on. Written as an .or(), the
  // search would still work and would silently stop using the index.
  it('searches SCL number, client number and title with a single ilike on search_text', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(stub.client, parseMdrSearchParams({ q: 'survey' }))
    const ilikes = stub.calls.filter((c) => c.method === 'ilike')
    expect(ilikes).toHaveLength(1)
    expect(ilikes[0].args).toEqual(['search_text', '%survey%'])
    expect(stub.calls.filter((c) => c.method === 'or')).toHaveLength(0)
  })

  it('never selects search_text — it is a filter field, not a display field', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(stub.client, parseMdrSearchParams({ q: 'survey' }))
    const select = stub.calls.find((c) => c.method === 'select')
    expect(String(select?.args[0])).not.toContain('search_text')
  })

  it('orders in SQL, and adds a stable tiebreaker when the sort is not the number', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(stub.client, parseMdrSearchParams({ sort: 'title', dir: 'desc' }))
    const orders = stub.calls.filter((c) => c.method === 'order').map((c) => c.args)
    expect(orders[0]).toEqual(['title', { ascending: false, nullsFirst: false }])
    // Without this, two documents with the same title can swap places between
    // requests and paging shows one of them twice.
    expect(orders[1]).toEqual(['scl_doc_number', { ascending: true, nullsFirst: false }])
  })

  it('does not add a redundant tiebreaker when already sorting by the number', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrPage(stub.client, parseMdrSearchParams({}))
    expect(stub.calls.filter((c) => c.method === 'order')).toHaveLength(1)
  })

  it('pages in SQL with .range(), not by slicing the result', async () => {
    const stub = stubClient([ROW], 500)
    await listMdrPage(stub.client, parseMdrSearchParams({ page: '3' }))
    const range = stub.calls.find((c) => c.method === 'range')
    expect(range?.args).toEqual([2 * MDR_PAGE_SIZE, 3 * MDR_PAGE_SIZE - 1])
  })

  it('returns the rows the database returned, untouched and in order', async () => {
    const rows = [
      { document_id: 'b', scl_doc_number: 'SC2699-SCL-AA-0002-PL' },
      { document_id: 'a', scl_doc_number: 'SC2699-SCL-AA-0001-PL' },
    ]
    const stub = stubClient(rows, 2)
    const page = await listMdrPage(stub.client, parseMdrSearchParams({ q: 'x', project: PROJECT }))
    // Deliberately out of order: if anything in listMdrPage sorted or filtered
    // in JavaScript, this would come back re-ordered or shorter.
    expect(page.rows.map((r) => r.document_id)).toEqual(['b', 'a'])
  })

  it('reports an empty register as one page, not zero', async () => {
    const stub = stubClient([], 0)
    const page = await listMdrPage(stub.client, parseMdrSearchParams({}))
    expect(page.total).toBe(0)
    expect(page.pageCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Column visibility (DCS 1b.06)
// ---------------------------------------------------------------------------

describe('column selection', () => {
  it('lists every annex-C column key, in sheet order, derived from the groups', () => {
    expect(MDR_ALL_COLUMN_KEYS).toHaveLength(MDR_COLUMN_COUNT)
    expect(MDR_ALL_COLUMN_KEYS[0]).toBe('process')
    expect(MDR_ALL_COLUMN_KEYS).toContain('scl_doc_number')
    expect(new Set(MDR_ALL_COLUMN_KEYS).size).toBe(MDR_ALL_COLUMN_KEYS.length)
  })

  // The distinction the whole feature rests on: "no choice made" is not "no
  // columns". Getting this backwards exports an empty sheet for every user who
  // never opened the picker.
  it('treats an empty selection as EVERY column, not as none', () => {
    expect(normaliseColumnSelection([])).toEqual([])
    expect(isColumnVisible([], 'title')).toBe(true)
    expect(visibleColumnGroups([])).toHaveLength(MDR_COLUMN_GROUPS.length)
    expect(columnCount(visibleColumnGroups([]))).toBe(MDR_COLUMN_COUNT)
  })

  it('drops unknown keys rather than failing — a hand-edited ?cols= still renders', () => {
    expect(normaliseColumnSelection(['title', 'banana', 'DROP TABLE'])).toEqual([
      'scl_doc_number',
      'title',
    ])
  })

  it('always puts the SCL number back, even when a saved view omits it', () => {
    expect(normaliseColumnSelection(['title'])).toContain(MDR_REQUIRED_COLUMN_KEY)
  })

  it('re-sorts into annex-C order regardless of the order asked for', () => {
    expect(normaliseColumnSelection(['budget_hours', 'process', 'title'])).toEqual([
      'process',
      'scl_doc_number',
      'title',
      'budget_hours',
    ])
  })

  it('drops a group that loses every one of its columns', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'title'])
    expect(groups.map((g) => g.label)).toEqual(['DOCUMENT INFO'])
    expect(columnCount(groups)).toBe(2)
  })

  it('keeps a partially hidden group, narrowed to what survives', () => {
    const groups = visibleColumnGroups(['scl_doc_number', 'issue_date'])
    expect(groups.map((g) => g.label)).toEqual(['DOCUMENT INFO', 'STATUS'])
    expect(groups[1]?.columns.map((c) => c.key)).toEqual(['issue_date'])
  })

  // The serialiser normalises too, so a link and the page it leads to cannot
  // disagree: asking for ['title'] alone yields a URL that reads back WITH the
  // SCL number, because that is what the screen will actually show.
  it('round-trips a selection through the URL, normalised at both ends', () => {
    const href = mdrHref(parseMdrSearchParams({}), { columns: ['title', 'issue_date'] })
    const qs = Object.fromEntries(new URLSearchParams(href.split('?')[1]))
    // URLSearchParams percent-encodes the separator; decoding is the parser's
    // job and the assertion is about the round trip, not the spelling.
    expect(qs.cols).toBe('scl_doc_number,title,issue_date')
    expect(parseMdrSearchParams(qs).columns).toEqual(['scl_doc_number', 'title', 'issue_date'])
  })

  it('leaves cols out of the URL when every column is shown', () => {
    expect(mdrHref(parseMdrSearchParams({}), { columns: [] })).toBe('/mdr')
  })
})

// ---------------------------------------------------------------------------
// The export's read — same builder, no paging (DCS 1b.06)
// ---------------------------------------------------------------------------

describe('listMdrAll', () => {
  it('applies exactly the same filters, search and ordering as listMdrPage', async () => {
    const params = { project: PROJECT, type: TYPE, orig: ORIG, status: STATUS, discipline: DISCIPLINE, q: 'RA-00', sort: 'title', dir: 'desc' }
    const query = parseMdrSearchParams(params)

    const paged = stubClient([ROW], 1)
    await listMdrPage(paged.client, query)
    const all = stubClient([ROW], 1)
    await listMdrAll(all.client, query)

    // Everything except select (no count on the export) and range (the export
    // walks the result) has to be identical — that identity IS the guarantee
    // the sheet matches the screen.
    const shape = (calls: { method: string; args: unknown[] }[]) =>
      calls.filter((c) => c.method !== 'select' && c.method !== 'range')
    expect(shape(all.calls)).toEqual(shape(paged.calls))
  })

  it('ignores the page — the export is the whole filtered register', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrAll(stub.client, parseMdrSearchParams({ page: '7' }))
    expect(stub.calls.filter((c) => c.method === 'range')[0]?.args).toEqual([0, 499])
  })

  it('stops after a short chunk instead of querying forever', async () => {
    const stub = stubClient([ROW], 1)
    const { rows, truncated } = await listMdrAll(stub.client, parseMdrSearchParams({}))
    expect(stub.fromCount).toBe(1)
    expect(rows).toHaveLength(1)
    expect(truncated).toBe(false)
  })

  // PostgREST's max_rows (1000 in supabase/config.toml) truncates silently, so
  // a single unbounded request would produce a short export with no error at
  // all. This is the assertion that the read is chunked.
  it('asks for a chunk below PostgREST max_rows, not for everything at once', async () => {
    const stub = stubClient([ROW], 1)
    await listMdrAll(stub.client, parseMdrSearchParams({}))
    const [from, to] = stub.calls.find((c) => c.method === 'range')?.args as [number, number]
    expect(to - from + 1).toBeLessThan(1000)
  })

  it('keeps walking while chunks come back full, and concatenates them in order', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ ...ROW, document_id: `d${i}` }))
    let call = 0
    const request: Record<string, unknown> = {
      then: (onOk: (v: unknown) => unknown) => {
        call += 1
        // Two full chunks, then a short one.
        return Promise.resolve({ data: call <= 2 ? full : [ROW], error: null }).then(onOk)
      },
    }
    for (const method of ['select', 'eq', 'ilike', 'order', 'range']) {
      request[method] = () => request
    }
    const client = { schema: () => ({ from: () => request }) } as never

    const { rows, truncated } = await listMdrAll(client, parseMdrSearchParams({}))
    expect(rows).toHaveLength(1001)
    expect(truncated).toBe(false)
    expect(call).toBe(3)
  })
})
