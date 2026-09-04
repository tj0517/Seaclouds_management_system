import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  ProjectRoleAuthorizationError,
  checkProjectRole,
  fetchUserProjectRoles,
  hasAnyRole,
  loadUserProjectRoles,
  type ProjectRole,
} from './auth-helpers'

const PEJ = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'
const IT = '094e130b-599b-4295-87fa-697fb71e7fc4'

/** Minimal stand-in for the `.schema('dcs').from('project_roles').select().eq()` chain. */
function stubClient(rows: { project_id: string; role: ProjectRole }[]) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as unknown as SupabaseClient<Database>, eq }
}

describe('fetchUserProjectRoles', () => {
  it('groups rows by project_id', async () => {
    const { client } = stubClient([
      { project_id: PEJ, role: 'chk' },
      { project_id: PEJ, role: 'app' },
      { project_id: IT, role: 'dc' },
    ])

    const result = await fetchUserProjectRoles(client, 'user-1')

    expect(result.get(PEJ)).toEqual(['chk', 'app'])
    expect(result.get(IT)).toEqual(['dc'])
  })

  it('throws a readable error on a query failure', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const client = {
      schema: () => ({ from: () => ({ select: () => ({ eq }) }) }),
    } as unknown as SupabaseClient<Database>

    await expect(fetchUserProjectRoles(client, 'user-1')).rejects.toThrow(/boom/)
  })
})

describe('loadUserProjectRoles', () => {
  it('issues a single query per userId per store', async () => {
    const { client, eq } = stubClient([{ project_id: PEJ, role: 'chk' }])
    const store = new Map<string, Promise<Map<string, ProjectRole[]>>>()

    await loadUserProjectRoles(store, client, 'user-1')
    await loadUserProjectRoles(store, client, 'user-1')

    expect(eq).toHaveBeenCalledTimes(1)
  })

  it('queries again for a different userId in the same store', async () => {
    const { client, eq } = stubClient([{ project_id: PEJ, role: 'chk' }])
    const store = new Map<string, Promise<Map<string, ProjectRole[]>>>()

    await loadUserProjectRoles(store, client, 'user-1')
    await loadUserProjectRoles(store, client, 'user-2')

    expect(eq).toHaveBeenCalledTimes(2)
  })

  it('queries again against a fresh store (new request)', async () => {
    const { client, eq } = stubClient([{ project_id: PEJ, role: 'chk' }])

    await loadUserProjectRoles(new Map(), client, 'user-1')
    await loadUserProjectRoles(new Map(), client, 'user-1')

    expect(eq).toHaveBeenCalledTimes(2)
  })
})

describe('hasAnyRole (the <IfRole> decision)', () => {
  it('is true for a holder of the required role', () => {
    expect(hasAnyRole(['chk', 'app'], ['app'])).toBe(true)
  })

  it('is false for a non-holder', () => {
    expect(hasAnyRole([], ['dc'])).toBe(false)
  })

  it('is false for a holder of a different role on the same project', () => {
    expect(hasAnyRole(['view'], ['dc'])).toBe(false)
  })
})

describe('checkProjectRole / requireProjectRole', () => {
  function rolesByProject(entries: [string, ProjectRole[]][]) {
    return new Map(entries)
  }

  it('passes silently for a holder of the role on that project', () => {
    const roles = rolesByProject([[PEJ, ['dc']]])
    expect(() => checkProjectRole(roles, PEJ, ['dc'])).not.toThrow()
  })

  it('throws for a user with no role on the project', () => {
    const roles = rolesByProject([])
    expect(() => checkProjectRole(roles, PEJ, ['dc'])).toThrow(ProjectRoleAuthorizationError)
  })

  it('throws for a user holding the role only on a different project', () => {
    const roles = rolesByProject([[IT, ['dc']]])
    expect(() => checkProjectRole(roles, PEJ, ['dc'])).toThrow(ProjectRoleAuthorizationError)
  })

  it('the thrown error names the project and the required roles', () => {
    const roles = rolesByProject([])
    try {
      checkProjectRole(roles, PEJ, ['dc', 'chk'])
      throw new Error('expected checkProjectRole to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectRoleAuthorizationError)
      const e = err as ProjectRoleAuthorizationError
      expect(e.message).toContain(PEJ)
      expect(e.message).toContain('dc')
      expect(e.message).toContain('chk')
      expect(e.projectId).toBe(PEJ)
      expect(e.requiredRoles).toEqual(['dc', 'chk'])
    }
  })
})
