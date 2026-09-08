import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  grantProjectRole,
  parseSetProjectRolesInput,
  revokeProjectRole,
  setProjectRoles,
  type ProjectRole,
} from './project-roles'

const PEJ = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc'
const IT = '094e130b-599b-4295-87fa-697fb71e7fc4'
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DC_OF_PEJ = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OUTSIDER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const TARGET_USER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

/**
 * Stubs the exact chains lib/project-roles.ts issues: auth.getUser(),
 * profiles.select().eq().single(), and .schema('dcs').from('project_roles')
 * for both fetchUserProjectRoles's shape (select().eq()) and the
 * insert/delete/select paths setProjectRoles and grant/revoke use.
 */
function stubClient(opts: {
  sessionUserId: string
  role: 'admin' | 'employee'
  dcProjectIds?: string[]
  currentRoles?: { id: string; role: ProjectRole }[]
}) {
  const { sessionUserId, role, dcProjectIds = [], currentRoles = [] } = opts

  const insert = vi.fn().mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'new-row' }, error: null }) }),
  })
  const deleteMock = vi.fn().mockReturnValue({
    eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'row-1' }], error: null }) }) }),
    in: () => Promise.resolve({ error: null }),
  })

  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { role }, error: null }) }) }) }
    }
    throw new Error(`unexpected public.from(${table})`)
  })

  const dcsFrom = vi.fn((table: string) => {
    if (table !== 'project_roles') throw new Error(`unexpected dcs.from(${table})`)
    return {
      // fetchUserProjectRoles: .select('project_id, role').eq('user_id', id)
      // setProjectRoles' read: .select('id, role').eq('project_id', ..).eq('user_id', ..)
      select: (cols: string) => {
        if (cols === 'project_id, role') {
          return {
            eq: () =>
              Promise.resolve({
                data: dcProjectIds.map((projectId) => ({ project_id: projectId, role: 'dc' as ProjectRole })),
                error: null,
              }),
          }
        }
        return {
          eq: () => ({
            eq: () => Promise.resolve({ data: currentRoles, error: null }),
          }),
        }
      },
      insert,
      delete: deleteMock,
    }
  })

  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: sessionUserId } } }) },
    from,
    schema: (name: string) => {
      if (name !== 'dcs') throw new Error(`unexpected schema(${name})`)
      return { from: dcsFrom }
    },
  } as unknown as SupabaseClient<Database>

  return { client, insert, delete: deleteMock }
}

describe('parseSetProjectRolesInput', () => {
  it('accepts a valid input and dedupes roles', () => {
    const result = parseSetProjectRolesInput({
      projectId: PEJ,
      userId: TARGET_USER,
      roles: ['orig', 'rev', 'orig'],
    })
    expect(result).toEqual({ projectId: PEJ, userId: TARGET_USER, roles: ['orig', 'rev'] })
  })

  it('rejects a non-UUID projectId', () => {
    expect(parseSetProjectRolesInput({ projectId: 'not-a-uuid', userId: TARGET_USER, roles: [] })).toBeNull()
  })

  it('rejects an unknown role value', () => {
    expect(
      parseSetProjectRolesInput({ projectId: PEJ, userId: TARGET_USER, roles: ['orig', 'made-up'] }),
    ).toBeNull()
  })

  it('accepts an empty role set (revoke everything)', () => {
    expect(parseSetProjectRolesInput({ projectId: PEJ, userId: TARGET_USER, roles: [] })).toEqual({
      projectId: PEJ,
      userId: TARGET_USER,
      roles: [],
    })
  })
})

describe('setProjectRoles authorization (admin-or-DC guard)', () => {
  it('admin may set roles on any project', async () => {
    const { client } = stubClient({ sessionUserId: ADMIN, role: 'admin' })
    const result = await setProjectRoles(client, { projectId: IT, userId: TARGET_USER, roles: ['orig'] })
    expect(result.ok).toBe(true)
  })

  it('DC of the target project may set roles on it', async () => {
    const { client } = stubClient({ sessionUserId: DC_OF_PEJ, role: 'employee', dcProjectIds: [PEJ] })
    const result = await setProjectRoles(client, { projectId: PEJ, userId: TARGET_USER, roles: ['orig'] })
    expect(result.ok).toBe(true)
  })

  it('DC of P is forbidden from setting roles on Q', async () => {
    const { client } = stubClient({ sessionUserId: DC_OF_PEJ, role: 'employee', dcProjectIds: [PEJ] })
    const result = await setProjectRoles(client, { projectId: IT, userId: TARGET_USER, roles: ['orig'] })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('a plain member (no dc role anywhere) is forbidden', async () => {
    const { client } = stubClient({ sessionUserId: OUTSIDER, role: 'employee' })
    const result = await setProjectRoles(client, { projectId: PEJ, userId: TARGET_USER, roles: ['orig'] })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('rejects invalid input before touching the database', async () => {
    const { client, insert } = stubClient({ sessionUserId: ADMIN, role: 'admin' })
    const result = await setProjectRoles(client, { projectId: 'bad', userId: TARGET_USER, roles: ['orig'] })
    expect(result).toEqual({ ok: false, error: 'invalid_input' })
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('setProjectRoles diffing', () => {
  it('grants only the roles not already held', async () => {
    const { client, insert } = stubClient({
      sessionUserId: ADMIN,
      role: 'admin',
      currentRoles: [{ id: 'row-orig', role: 'orig' }],
    })
    const result = await setProjectRoles(client, {
      projectId: PEJ,
      userId: TARGET_USER,
      roles: ['orig', 'rev'],
    })
    expect(result).toEqual({ ok: true, data: { granted: ['rev'], revoked: [] } })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith([
      { project_id: PEJ, user_id: TARGET_USER, role: 'rev', assigned_by: ADMIN },
    ])
  })

  it('revokes only the roles no longer wanted', async () => {
    const { client, delete: deleteMock } = stubClient({
      sessionUserId: ADMIN,
      role: 'admin',
      currentRoles: [
        { id: 'row-orig', role: 'orig' },
        { id: 'row-rev', role: 'rev' },
      ],
    })
    const result = await setProjectRoles(client, { projectId: PEJ, userId: TARGET_USER, roles: ['orig'] })
    expect(result).toEqual({ ok: true, data: { granted: [], revoked: ['rev'] } })
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })

  it('a no-op save (same set) issues neither insert nor delete', async () => {
    const { client, insert, delete: deleteMock } = stubClient({
      sessionUserId: ADMIN,
      role: 'admin',
      currentRoles: [{ id: 'row-orig', role: 'orig' }],
    })
    const result = await setProjectRoles(client, { projectId: PEJ, userId: TARGET_USER, roles: ['orig'] })
    expect(result).toEqual({ ok: true, data: { granted: [], revoked: [] } })
    expect(insert).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

describe('grantProjectRole / revokeProjectRole authorization (aligned with setProjectRoles)', () => {
  it('grantProjectRole allows a DC of the target project', async () => {
    const { client } = stubClient({ sessionUserId: DC_OF_PEJ, role: 'employee', dcProjectIds: [PEJ] })
    const result = await grantProjectRole(client, { projectId: PEJ, userId: TARGET_USER, role: 'orig' })
    expect(result.ok).toBe(true)
  })

  it('grantProjectRole forbids a DC of a different project', async () => {
    const { client } = stubClient({ sessionUserId: DC_OF_PEJ, role: 'employee', dcProjectIds: [PEJ] })
    const result = await grantProjectRole(client, { projectId: IT, userId: TARGET_USER, role: 'orig' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('revokeProjectRole forbids a DC of a different project', async () => {
    const { client } = stubClient({ sessionUserId: DC_OF_PEJ, role: 'employee', dcProjectIds: [PEJ] })
    const result = await revokeProjectRole(client, { projectId: IT, userId: TARGET_USER, role: 'orig' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })
})
