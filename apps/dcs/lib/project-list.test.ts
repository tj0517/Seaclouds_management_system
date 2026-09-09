import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import { resolveProjectListFilter } from './project-list'

const PEJ = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'
const IT = '094e130b-599b-4295-87fa-697fb71e7fc4'
const USER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

/** Stubs the exact chain fetchUserProjectRoles issues: schema('dcs').from('project_roles').select().eq(). */
function stubClient(opts: { roleRows?: { project_id: string; role: string }[]; failWith?: Error }) {
  const { roleRows = [], failWith } = opts
  const eqMock = vi.fn(() =>
    failWith ? Promise.reject(failWith) : Promise.resolve({ data: roleRows, error: null }),
  )
  const client = {
    schema: (name: string) => {
      if (name !== 'dcs') throw new Error(`unexpected schema(${name})`)
      return {
        from: (table: string) => {
          if (table !== 'project_roles') throw new Error(`unexpected dcs.from(${table})`)
          return { select: () => ({ eq: eqMock }) }
        },
      }
    },
  } as unknown as SupabaseClient<Database>
  return client
}

describe('resolveProjectListFilter', () => {
  it('admin gets kind "all" without reading project_roles at all', async () => {
    const client = stubClient({})
    const fromSpy = vi.spyOn(client, 'schema')
    const result = await resolveProjectListFilter(client, USER, true)
    expect(result).toEqual({ kind: 'all' })
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('member with roles gets the distinct set of project ids', async () => {
    const client = stubClient({
      roleRows: [
        { project_id: PEJ, role: 'view' },
        { project_id: PEJ, role: 'orig' },
        { project_id: IT, role: 'dc' },
      ],
    })
    const result = await resolveProjectListFilter(client, USER, false)
    expect(result.kind).toBe('ids')
    expect(result.kind === 'ids' && [...result.ids].sort()).toEqual([IT, PEJ].sort())
  })

  it('member with zero roles gets an empty id list, not degraded', async () => {
    const client = stubClient({ roleRows: [] })
    const result = await resolveProjectListFilter(client, USER, false)
    expect(result).toEqual({ kind: 'ids', ids: [] })
  })

  it('a read failure degrades to kind "degraded", not a silent empty list', async () => {
    const client = stubClient({ failWith: new Error('connection reset') })
    const result = await resolveProjectListFilter(client, USER, false)
    expect(result).toEqual({ kind: 'degraded' })
  })
})
