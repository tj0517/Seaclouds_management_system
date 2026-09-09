import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import { excludeIds, getProfileDirectory, type DirectoryEntry } from './profile-directory'

function stubClient(result: { data: DirectoryEntry[] | null; error: { message: string } | null }) {
  return {
    rpc: (fn: string) => {
      if (fn !== 'dcs_profile_directory') throw new Error(`unexpected rpc(${fn})`)
      return Promise.resolve(result)
    },
  } as unknown as SupabaseClient<Database>
}

describe('getProfileDirectory', () => {
  it('returns the rows from dcs_profile_directory() on success', async () => {
    const rows = [
      { id: 'a', full_name: 'Alice' },
      { id: 'b', full_name: null },
    ]
    const result = await getProfileDirectory(stubClient({ data: rows, error: null }))
    expect(result).toEqual({ entries: rows, degraded: false })
  })

  it('degrades to an empty directory on error, without throwing', async () => {
    const result = await getProfileDirectory(stubClient({ data: null, error: { message: 'boom' } }))
    expect(result).toEqual({ entries: [], degraded: true })
  })
})

describe('excludeIds', () => {
  const entries: DirectoryEntry[] = [
    { id: 'a', full_name: 'Alice' },
    { id: 'b', full_name: 'Bob' },
    { id: 'c', full_name: 'Cid' },
  ]

  it('removes entries whose id is in the exclude set', () => {
    expect(excludeIds(entries, ['b'])).toEqual([
      { id: 'a', full_name: 'Alice' },
      { id: 'c', full_name: 'Cid' },
    ])
  })

  it('is a no-op for an empty exclude set', () => {
    expect(excludeIds(entries, [])).toEqual(entries)
  })

  it('excludes every entry when every id is given', () => {
    expect(excludeIds(entries, ['a', 'b', 'c'])).toEqual([])
  })
})
