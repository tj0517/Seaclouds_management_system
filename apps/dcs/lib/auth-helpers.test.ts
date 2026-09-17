import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  ProjectRoleAuthorizationError,
  canOpenAdminScreens,
  checkProjectRole,
  fetchUserProjectRoles,
  hasAnyRole,
  isAdminOrAnyDc,
  isAdminOrProjectDc,
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

// ---------------------------------------------------------------------------
// DCS 1a.21a: the three rendering/guard decisions added for the 1a gate demo.
// Cases are named after the real scl-dev personas the acceptance criteria
// use, so a failure here reads as "which account broke".
// ---------------------------------------------------------------------------

const SC2601 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** dcs1a14-dc: DC of SC2602 and SC2699, plus a non-DC role on SC2602. */
const DC_OF_TWO = new Map<string, ProjectRole[]>([
  [PEJ, ['dc', 'rev']],
  [IT, ['dc']],
])

/** dcs1a14-member: roles on two projects, DC of none. */
const MEMBER_ROLES = new Map<string, ProjectRole[]>([
  [PEJ, ['orig', 'view']],
  [IT, ['orig']],
])

describe('isAdminOrAnyDc (the /admin page guards and the sidebar links)', () => {
  it('admin: true, without consulting the roles map at all', () => {
    expect(isAdminOrAnyDc(true, new Map())).toBe(true)
  })

  it('dcs1a14-dc: true — DC of at least one project', () => {
    expect(isAdminOrAnyDc(false, DC_OF_TWO)).toBe(true)
  })

  it('dcs1a14-member: false — roles on two projects, DC of neither', () => {
    expect(isAdminOrAnyDc(false, MEMBER_ROLES)).toBe(false)
  })

  it('a user with no DCS roles at all: false', () => {
    expect(isAdminOrAnyDc(false, new Map())).toBe(false)
  })

  it('one dc row anywhere is enough, even among non-dc roles on other projects', () => {
    const mixed = new Map<string, ProjectRole[]>([
      [PEJ, ['orig', 'view']],
      [IT, ['chk', 'dc']],
    ])
    expect(isAdminOrAnyDc(false, mixed)).toBe(true)
  })
})

describe('isAdminOrProjectDc (the per-row "Team" link)', () => {
  it('admin: true on every project, including one they hold no role on', () => {
    expect(isAdminOrProjectDc(true, new Map(), SC2601)).toBe(true)
    expect(isAdminOrProjectDc(true, new Map(), PEJ)).toBe(true)
  })

  it('dcs1a14-dc: true on the projects they are DC of', () => {
    expect(isAdminOrProjectDc(false, DC_OF_TWO, PEJ)).toBe(true)
    expect(isAdminOrProjectDc(false, DC_OF_TWO, IT)).toBe(true)
  })

  it('dcs1a14-dc: false on a project they are not DC of — this is the scoping', () => {
    expect(isAdminOrProjectDc(false, DC_OF_TWO, SC2601)).toBe(false)
  })

  it('being DC somewhere does not carry to a project held with a lesser role', () => {
    const dcElsewhere = new Map<string, ProjectRole[]>([
      [IT, ['dc']],
      [PEJ, ['orig']],
    ])
    expect(isAdminOrProjectDc(false, dcElsewhere, PEJ)).toBe(false)
  })

  it('dcs1a14-member: false on every project they hold', () => {
    expect(isAdminOrProjectDc(false, MEMBER_ROLES, PEJ)).toBe(false)
    expect(isAdminOrProjectDc(false, MEMBER_ROLES, IT)).toBe(false)
  })
})

describe('canOpenAdminScreens (the read behind the guards)', () => {
  it('admin: true without issuing the project_roles query', async () => {
    const { client, eq } = stubClient([])
    await expect(canOpenAdminScreens(client, 'user-1', true)).resolves.toBe(true)
    expect(eq).not.toHaveBeenCalled()
  })

  it('dcs1a14-dc: true, read from dcs.project_roles', async () => {
    const { client } = stubClient([{ project_id: PEJ, role: 'dc' }])
    await expect(canOpenAdminScreens(client, 'user-1', false)).resolves.toBe(true)
  })

  it('dcs1a14-member: false', async () => {
    const { client } = stubClient([
      { project_id: PEJ, role: 'orig' },
      { project_id: PEJ, role: 'view' },
    ])
    await expect(canOpenAdminScreens(client, 'user-1', false)).resolves.toBe(false)
  })

  it('degrades CLOSED on a read failure instead of throwing', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    const client = {
      schema: () => ({ from: () => ({ select: () => ({ eq }) }) }),
    } as unknown as SupabaseClient<Database>
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(canOpenAdminScreens(client, 'user-1', false)).resolves.toBe(false)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('a read failure never refuses an admin — the query is skipped', async () => {
    const eq = vi.fn().mockRejectedValue(new Error('connection reset'))
    const client = {
      schema: () => ({ from: () => ({ select: () => ({ eq }) }) }),
    } as unknown as SupabaseClient<Database>

    await expect(canOpenAdminScreens(client, 'user-1', true)).resolves.toBe(true)
  })
})
