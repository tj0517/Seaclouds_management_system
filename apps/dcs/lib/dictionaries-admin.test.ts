import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  createDictionaryEntry,
  parseCreateDictionaryEntryInput,
  parseUpdateDictionaryEntryInput,
  setDictionaryEntryActive,
  updateDictionaryEntry,
} from './dictionaries-admin'
import type { DictionaryRow } from './dictionaries'

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const EMPLOYEE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const ROW_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function makeRow(overrides: Partial<DictionaryRow> = {}): DictionaryRow {
  return {
    id: ROW_ID,
    dict_type: 'discipline',
    code: 'EL',
    label: 'Electrical',
    description: null,
    meta: {},
    sort_order: 0,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Stubs the exact chains lib/dictionaries-admin.ts issues: auth.getUser(),
 * profiles.select().eq().single() (the guard's role read),
 * dcs.project_roles.select().eq().eq().limit() (the guard's DC read), and
 * dcs.dictionaries insert/select/update for the three mutations.
 */
function stubClient(opts: {
  sessionUserId: string
  role: 'admin' | 'employee'
  isDc?: boolean
  currentRow?: DictionaryRow | null
}) {
  const { sessionUserId, role, isDc = false, currentRow = null } = opts

  const insertMock = vi.fn((payload: Record<string, unknown>) => ({
    select: () => ({
      single: () => Promise.resolve({ data: { ...makeRow(), ...payload, id: 'new-id' }, error: null }),
    }),
  }))

  const updateMock = vi.fn((payload: Record<string, unknown>) => ({
    eq: () => ({
      select: (cols?: string) => {
        if (cols === 'id, is_active') {
          return {
            maybeSingle: () =>
              Promise.resolve({
                data: { id: currentRow?.id ?? ROW_ID, is_active: payload.is_active },
                error: null,
              }),
          }
        }
        return {
          single: () => Promise.resolve({ data: { ...(currentRow ?? makeRow()), ...payload }, error: null }),
        }
      },
    }),
  }))

  const selectCurrentRowMock = vi.fn(() => ({
    eq: () => ({
      maybeSingle: () => Promise.resolve({ data: currentRow, error: null }),
    }),
  }))

  const dictionariesFrom = vi.fn(() => ({
    insert: insertMock,
    update: updateMock,
    select: selectCurrentRowMock,
  }))

  const projectRolesFrom = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: isDc ? [{ id: 'dc-row' }] : [], error: null }),
        }),
      }),
    }),
  }))

  const dcsFrom = vi.fn((table: string) => {
    if (table === 'dictionaries') return dictionariesFrom()
    if (table === 'project_roles') return projectRolesFrom()
    throw new Error(`unexpected dcs.from(${table})`)
  })

  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { role }, error: null }) }) }) }
    }
    throw new Error(`unexpected public.from(${table})`)
  })

  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: sessionUserId } } }) },
    from,
    schema: (name: string) => {
      if (name !== 'dcs') throw new Error(`unexpected schema(${name})`)
      return { from: dcsFrom }
    },
  } as unknown as SupabaseClient<Database>

  return { client, insertMock, updateMock }
}

describe('parseCreateDictionaryEntryInput', () => {
  it('accepts a valid doc_type entry with budget hours', () => {
    const parsed = parseCreateDictionaryEntryInput({
      dictType: 'doc_type',
      code: 'RA',
      label: 'Risk Assessment',
      budgetHours: 12,
    })
    expect(parsed).toEqual({
      dictType: 'doc_type',
      code: 'RA',
      label: 'Risk Assessment',
      description: null,
      sortOrder: 0,
      budgetHours: 12,
    })
  })

  it('rejects an unknown dict_type', () => {
    expect(parseCreateDictionaryEntryInput({ dictType: 'colour', code: 'X', label: 'X' })).toBeNull()
  })

  it('rejects an empty code', () => {
    expect(parseCreateDictionaryEntryInput({ dictType: 'discipline', code: '  ', label: 'X' })).toBeNull()
  })

  it('rejects a negative budget_hours for doc_type', () => {
    expect(
      parseCreateDictionaryEntryInput({ dictType: 'doc_type', code: 'RA', label: 'X', budgetHours: -1 }),
    ).toBeNull()
  })

  it('rejects a non-numeric budget_hours for doc_type', () => {
    expect(
      parseCreateDictionaryEntryInput({ dictType: 'doc_type', code: 'RA', label: 'X', budgetHours: 'lots' }),
    ).toBeNull()
  })

  it('rejects budget_hours on a non-doc_type dictionary', () => {
    expect(
      parseCreateDictionaryEntryInput({ dictType: 'discipline', code: 'EL', label: 'X', budgetHours: 5 }),
    ).toBeNull()
  })

  it('is fine when budget_hours is omitted on a non-doc_type dictionary', () => {
    const parsed = parseCreateDictionaryEntryInput({ dictType: 'discipline', code: 'EL', label: 'X' })
    expect(parsed?.budgetHours).toBeNull()
  })
})

describe('parseUpdateDictionaryEntryInput', () => {
  it('ignores a code field present in the raw payload', () => {
    const parsed = parseUpdateDictionaryEntryInput({ id: ROW_ID, label: 'New label', code: 'HACKED' })
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('code')
  })

  it('rejects a missing label', () => {
    expect(parseUpdateDictionaryEntryInput({ id: ROW_ID })).toBeNull()
  })

  it('rejects a non-UUID id', () => {
    expect(parseUpdateDictionaryEntryInput({ id: 'not-a-uuid', label: 'X' })).toBeNull()
  })
})

describe('mutation guard (admin-or-any-DC)', () => {
  it('createDictionaryEntry rejects a plain employee (no dc role anywhere)', async () => {
    const { client } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee', isDc: false })
    const result = await createDictionaryEntry(client, { dictType: 'discipline', code: 'EL', label: 'Electrical' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('updateDictionaryEntry rejects a plain employee', async () => {
    const { client } = stubClient({
      sessionUserId: EMPLOYEE,
      role: 'employee',
      isDc: false,
      currentRow: makeRow(),
    })
    const result = await updateDictionaryEntry(client, { id: ROW_ID, label: 'New label' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('setDictionaryEntryActive rejects a plain employee', async () => {
    const { client } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee', isDc: false })
    const result = await setDictionaryEntryActive(client, { id: ROW_ID, isActive: false })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('createDictionaryEntry allows a DC who holds no admin role', async () => {
    const { client } = stubClient({ sessionUserId: DC, role: 'employee', isDc: true })
    const result = await createDictionaryEntry(client, { dictType: 'discipline', code: 'EL', label: 'Electrical' })
    expect(result.ok).toBe(true)
  })

  it('createDictionaryEntry allows an admin', async () => {
    const { client } = stubClient({ sessionUserId: ADMIN, role: 'admin' })
    const result = await createDictionaryEntry(client, { dictType: 'discipline', code: 'EL', label: 'Electrical' })
    expect(result.ok).toBe(true)
  })
})

describe('updateDictionaryEntry: code is immutable', () => {
  it('drops a code field in the raw payload — the stored code is unchanged', async () => {
    const currentRow = makeRow({ code: 'ORIGINAL' })
    const { client, updateMock } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })

    const result = await updateDictionaryEntry(client, {
      id: ROW_ID,
      label: 'New label',
      code: 'HACKED',
    } as unknown as Parameters<typeof updateDictionaryEntry>[1])

    expect(result.ok).toBe(true)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [payload] = updateMock.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('code')
    expect(result.ok && (result.data as DictionaryRow).code).toBe('ORIGINAL')
  })
})

describe('updateDictionaryEntry: budget_hours only applies to doc_type', () => {
  it('rejects budget_hours when the existing row is not doc_type', async () => {
    const currentRow = makeRow({ dict_type: 'discipline' })
    const { client } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })
    const result = await updateDictionaryEntry(client, { id: ROW_ID, label: 'X', budgetHours: 5 })
    expect(result).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('accepts budget_hours when the existing row is doc_type', async () => {
    const currentRow = makeRow({ dict_type: 'doc_type', code: 'RA' })
    const { client } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })
    const result = await updateDictionaryEntry(client, { id: ROW_ID, label: 'X', budgetHours: 8 })
    expect(result.ok).toBe(true)
  })
})
