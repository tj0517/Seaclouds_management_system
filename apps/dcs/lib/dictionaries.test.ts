import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import { getActiveDictionary, type DictionaryRow } from './dictionaries'

function makeRow(overrides: Partial<DictionaryRow>): DictionaryRow {
  return {
    id: 'row-id',
    dict_type: 'discipline',
    code: 'X',
    label: 'X',
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
 * Mirrors the exact chain getActiveDictionary issues:
 * .select('*').eq('dict_type', type).eq('is_active', true).order().order().
 * Filtering happens here in the stub the same way Postgres/RLS would filter
 * for real — this is what proves the function actually wires is_active into
 * the query, not just that it returns whatever the mock hands back.
 */
function stubClient(allRows: DictionaryRow[]) {
  const dictionariesFrom = () => ({
    select: () => ({
      eq: (col1: keyof DictionaryRow, val1: unknown) => {
        const afterFirst = allRows.filter((r) => r[col1] === val1)
        return {
          eq: (col2: keyof DictionaryRow, val2: unknown) => {
            const afterSecond = afterFirst.filter((r) => r[col2] === val2)
            return {
              order: () => ({
                order: () => Promise.resolve({ data: afterSecond, error: null }),
              }),
            }
          },
        }
      },
    }),
  })

  const client = {
    schema: (name: string) => {
      if (name !== 'dcs') throw new Error(`unexpected schema(${name})`)
      return { from: (table: string) => {
        if (table !== 'dictionaries') throw new Error(`unexpected dcs.from(${table})`)
        return dictionariesFrom()
      } }
    },
  } as unknown as SupabaseClient<Database>

  return client
}

describe('getActiveDictionary', () => {
  it('excludes inactive rows of the requested type', async () => {
    const rows = [
      makeRow({ id: '1', dict_type: 'discipline', code: 'PR', is_active: true }),
      makeRow({ id: '2', dict_type: 'discipline', code: 'OLD', is_active: false }),
      makeRow({ id: '3', dict_type: 'area', code: 'PR', is_active: true }),
    ]
    const result = await getActiveDictionary(stubClient(rows), 'discipline')
    expect(result.map((r) => r.code)).toEqual(['PR'])
  })

  it('returns an empty list when every row of the type is inactive', async () => {
    const rows = [makeRow({ id: '1', dict_type: 'discipline', code: 'OLD', is_active: false })]
    const result = await getActiveDictionary(stubClient(rows), 'discipline')
    expect(result).toEqual([])
  })

  it('throws a readable error when the query fails', async () => {
    const client = {
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>

    await expect(getActiveDictionary(client, 'discipline')).rejects.toThrow(/getActiveDictionary\(discipline\)/)
  })
})
