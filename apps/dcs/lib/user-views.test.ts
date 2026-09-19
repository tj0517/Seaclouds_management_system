// DCS 1b.06: saved views — the restore path and the name rules.
//
// What is NOT here, deliberately: any assertion about who may read or write a
// row. That is RLS, it is proved in supabase/tests/user_views_rls.test.sql
// with bare counts and a second user, and a unit test with a stub client that
// "checks ownership" would be theatre — the stub would be agreeing with
// itself. This file covers the pure logic: what a stored view turns back into,
// what the register's state turns into for storage, and what a name may be.
import { describe, expect, it } from 'vitest'
import {
  USER_VIEW_NAME_MAX,
  queryToFilters,
  validateViewName,
  viewToQuery,
} from './user-views'
import { MDR_DEFAULT_SORT, parseMdrSearchParams } from './mdr'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const STATUS = '44444444-4444-4444-8444-444444444444'

describe('viewToQuery', () => {
  it('restores the filters, the sort and the columns a view stored', () => {
    const query = viewToQuery({
      filters: { project: PROJECT, status: STATUS, q: 'RA-00', sort: 'title', dir: 'desc' },
      columns: ['title', 'issue_date'],
    })
    expect(query.projectId).toBe(PROJECT)
    expect(query.workflowStatusId).toBe(STATUS)
    expect(query.search).toBe('RA-00')
    expect(query.sort).toBe('title')
    expect(query.ascending).toBe(false)
    // Normalised on the way out: the SCL number comes back even though the
    // stored view did not list it.
    expect(query.columns).toEqual(['scl_doc_number', 'title', 'issue_date'])
  })

  it('never restores a page — a saved view is a way of looking, not a position', () => {
    expect(viewToQuery({ filters: { page: '7' }, columns: [] }).page).toBe(1)
  })

  // The whole reason the restore path goes through parseMdrSearchParams: the
  // jsonb is whatever is in the row, and a register that 500s because someone
  // hand-edited a saved view is worse than one that opens unfiltered.
  it('degrades a corrupt filter to the default instead of throwing', () => {
    const query = viewToQuery({
      filters: { project: 'not-a-uuid', sort: 'search_text', dir: 'sideways', page: 'banana' },
      columns: [],
    })
    expect(query.projectId).toBeNull()
    expect(query.sort).toBe(MDR_DEFAULT_SORT)
    expect(query.ascending).toBe(true)
    expect(query.page).toBe(1)
  })

  it('survives filters that are not an object at all', () => {
    expect(() => viewToQuery({ filters: null, columns: [] })).not.toThrow()
    expect(() => viewToQuery({ filters: ['nope'], columns: [] })).not.toThrow()
    expect(viewToQuery({ filters: 'nope', columns: [] }).projectId).toBeNull()
  })

  it('survives columns that are not an array of known keys', () => {
    expect(viewToQuery({ filters: {}, columns: null }).columns).toEqual([])
    expect(viewToQuery({ filters: {}, columns: { a: 1 } }).columns).toEqual([])
    expect(viewToQuery({ filters: {}, columns: ['title', 7, 'banana'] }).columns).toEqual([
      'scl_doc_number',
      'title',
    ])
  })

  // An empty stored column list means EVERY column — which is what a view
  // saved before the picker existed says, and what the migration's default is.
  it('reads an empty stored column list as every column', () => {
    expect(viewToQuery({ filters: {}, columns: [] }).columns).toEqual([])
  })
})

describe('queryToFilters', () => {
  it('stores the URL key names, so a saved view IS a query string in object form', () => {
    const query = parseMdrSearchParams({ project: PROJECT, q: 'RA', sort: 'title', dir: 'desc' })
    expect(queryToFilters(query)).toEqual({
      project: PROJECT,
      q: 'RA',
      sort: 'title',
      dir: 'desc',
    })
  })

  it('omits filters that are not set rather than storing nulls', () => {
    expect(queryToFilters(parseMdrSearchParams({}))).toEqual({
      sort: MDR_DEFAULT_SORT,
      dir: 'asc',
    })
  })

  it('never stores the page', () => {
    expect(queryToFilters(parseMdrSearchParams({ page: '4' }))).not.toHaveProperty('page')
  })

  // The property that makes save-then-restore safe: whatever the register is
  // showing, storing it and reading it back is the same register.
  it('round-trips through viewToQuery unchanged', () => {
    const original = parseMdrSearchParams({
      project: PROJECT,
      status: STATUS,
      q: 'RA-00',
      sort: 'issue_date',
      dir: 'desc',
      cols: 'title,issue_date',
    })
    const restored = viewToQuery({ filters: queryToFilters(original), columns: original.columns })
    expect(restored).toEqual(original)
  })
})

describe('validateViewName', () => {
  it('trims, because a name of spaces is the database CHECK firing on a typo', () => {
    expect(validateViewName('  Awaiting review  ')).toEqual({ ok: true, data: 'Awaiting review' })
  })

  it('refuses an empty or all-whitespace name before the database has to', () => {
    expect(validateViewName('').ok).toBe(false)
    expect(validateViewName('   ').ok).toBe(false)
  })

  it('refuses a name longer than the column CHECK allows', () => {
    expect(validateViewName('x'.repeat(USER_VIEW_NAME_MAX)).ok).toBe(true)
    expect(validateViewName('x'.repeat(USER_VIEW_NAME_MAX + 1)).ok).toBe(false)
  })

  it('agrees with the migration: 120 characters', () => {
    // If the CHECK in 20260919152836_create_dcs_user_views ever moves, this is
    // the line that has to move with it.
    expect(USER_VIEW_NAME_MAX).toBe(120)
  })
})
