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
  MDR_COLUMN_COUNT,
  MDR_COLUMN_GROUPS,
  MDR_DEFAULT_SORT,
  MDR_PAGE_SIZE,
  MDR_STATUS_COLORS,
  MDR_STATUS_COLOR_FALLBACK,
  escapeSearchTerm,
  hasActiveFilters,
  listMdrPage,
  mdrHref,
  mdrStatusColor,
  parseMdrSearchParams,
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
      expect(MDR_STATUS_COLORS[code], code).toBeTypeOf('string')
      expect(mdrStatusColor(code)).not.toBe(MDR_STATUS_COLOR_FALLBACK)
    }
    expect(Object.keys(MDR_STATUS_COLORS).sort()).toEqual([...SEEDED].sort())
  })

  // Red proof 3 from the task's verification list. A DC can add a
  // workflow_status row from /admin/dictionaries without a deploy, and the
  // register has to render that document rather than throw.
  it('falls back to a neutral palette for an unknown code instead of throwing', () => {
    expect(() => mdrStatusColor('SOMETHING_A_DC_ADDED')).not.toThrow()
    expect(mdrStatusColor('SOMETHING_A_DC_ADDED')).toBe(MDR_STATUS_COLOR_FALLBACK)
  })

  it('falls back for null and undefined too — v_mdr LEFT JOINs the dictionary', () => {
    expect(mdrStatusColor(null)).toBe(MDR_STATUS_COLOR_FALLBACK)
    expect(mdrStatusColor(undefined)).toBe(MDR_STATUS_COLOR_FALLBACK)
    expect(mdrStatusColor('')).toBe(MDR_STATUS_COLOR_FALLBACK)
  })

  // The whole point of keeping the palette in one constant (O-05 is open).
  it('never reaches outside MDR_STATUS_COLORS for a colour', () => {
    const known = new Set(Object.values(MDR_STATUS_COLORS))
    for (const code of SEEDED) expect(known.has(mdrStatusColor(code))).toBe(true)
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
