import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  DEFAULT_CYCLE,
  enableProjectMdr,
  getProjectsWithoutMdr,
  hasDocController,
  mapDbError,
  parseEnableProjectMdrInput,
  parseUpdateProjectMdrInput,
  skipsClientStep,
  updateProjectMdr,
  type EnableProjectMdrInput,
  type MdrSettingsRow,
  type ProjectRow,
} from './project-mdr'

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EMPLOYEE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PROJECT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CLIENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** The smallest payload the wizard can submit: just the picked project. */
function minimalInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { projectId: PROJECT_ID, ...overrides }
}

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    name: 'Alpha',
    description: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    project_code: 'SC2601',
    client_id: CLIENT_ID,
    process_type: 'project',
    year: 2026,
    ...overrides,
  }
}

function makeSettings(overrides: Partial<MdrSettingsRow> = {}): MdrSettingsRow {
  return {
    project_id: PROJECT_ID,
    cpy_numbering: false,
    cycle_idc_to_ifr: 7,
    cycle_ifr_to_retcom: 10,
    cycle_retcom_to_ifc: 7,
    budget_hours: 1000,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Stubs the exact chains lib/project-mdr.ts issues: auth.getUser(), the
 * guard's profiles.select().eq().single(), the RPC, and the two table reads /
 * two table updates the edit path uses. `projectUpdates` and
 * `settingsUpdates` record every patch that was actually sent — the diff-only
 * assertions read them, and an empty array is the assertion that NO statement
 * was issued at all (which, on dcs.mdr_settings, is the difference between
 * leaving updated_at alone and bumping it — see the module comment).
 */
function stubClient(opts: {
  sessionUserId?: string | null
  role?: 'admin' | 'employee'
  project?: ProjectRow | null
  settings?: MdrSettingsRow | null
  rpcResult?: { data: string | null; error: { code?: string; message: string } | null }
  /** getProjectsWithoutMdr's two source reads — unrelated to `project`/`settings` above. */
  projectsList?: ProjectRow[]
  mdrProjectIds?: string[]
}) {
  const {
    sessionUserId = ADMIN,
    role = 'admin',
    project = makeProject(),
    settings = makeSettings(),
    rpcResult = { data: PROJECT_ID, error: null },
    projectsList = [],
    mdrProjectIds = [],
  } = opts

  const projectUpdates: Record<string, unknown>[] = []
  const settingsUpdates: Record<string, unknown>[] = []
  const rpc = vi.fn(() => Promise.resolve(rpcResult))

  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: sessionUserId ? { id: sessionUserId } : null }, error: null }),
    },
    rpc,
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { role }, error: null }) }) }),
        }
      }
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: project, error: null }) }),
            order: () => Promise.resolve({ data: projectsList, error: null }),
          }),
          update: (payload: Record<string, unknown>) => {
            projectUpdates.push(payload)
            return { eq: () => Promise.resolve({ data: null, error: null }) }
          },
        }
      }
      throw new Error(`unexpected public table: ${table}`)
    },
    schema: (name: string) => {
      if (name !== 'dcs') throw new Error(`unexpected schema: ${name}`)
      return {
        from: (table: string) => {
          if (table !== 'mdr_settings') throw new Error(`unexpected dcs table: ${table}`)
          return {
            // Two shapes over the same select(): getProjectMdr/updateProjectMdr
            // chain .eq().maybeSingle(); getProjectsWithoutMdr awaits the
            // select() result directly — the `then` below is what makes that
            // work without a real Supabase query builder.
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: settings, error: null }) }),
              then: (resolve: (v: { data: { project_id: string }[]; error: null }) => void) =>
                resolve({ data: mdrProjectIds.map((id) => ({ project_id: id })), error: null }),
            }),
            update: (payload: Record<string, unknown>) => {
              settingsUpdates.push(payload)
              return { eq: () => Promise.resolve({ data: null, error: null }) }
            },
          }
        },
      }
    },
  }

  return { client: client as unknown as SupabaseClient<Database>, rpc, projectUpdates, settingsUpdates }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('hasDocController / skipsClientStep', () => {
  it('is false for a team with no dc — the wizard warns but does not block', () => {
    expect(hasDocController([{ userId: USER_ID, role: 'orig' }])).toBe(false)
    expect(hasDocController([{ userId: USER_ID, role: 'dc' }])).toBe(true)
  })

  it('skips the client step for internal projects only', () => {
    expect(skipsClientStep('internal')).toBe(true)
    expect(skipsClientStep('project')).toBe(false)
    expect(skipsClientStep('tender')).toBe(false)
    expect(skipsClientStep('course')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseEnableProjectMdrInput
// ---------------------------------------------------------------------------

describe('parseEnableProjectMdrInput', () => {
  it('accepts a minimal payload and applies the 7/10/7 cycle defaults', () => {
    const result = parseEnableProjectMdrInput(minimalInput())
    expect(result.ok).toBe(true)
    const data = (result as { ok: true; data: EnableProjectMdrInput }).data
    expect(data.projectId).toBe(PROJECT_ID)
    expect([data.cycleIdcToIfr, data.cycleIfrToRetcom, data.cycleRetcomToIfc]).toEqual([
      DEFAULT_CYCLE.idcToIfr,
      DEFAULT_CYCLE.ifrToRetcom,
      DEFAULT_CYCLE.retcomToIfc,
    ])
    expect(data.cpyNumbering).toBe(false)
    expect(data.budgetHours).toBeNull()
    expect(data.roles).toEqual([])
  })

  it('keeps explicit cycle lengths instead of the defaults', () => {
    const result = parseEnableProjectMdrInput(
      minimalInput({ cycleIdcToIfr: 5, cycleIfrToRetcom: 12, cycleRetcomToIfc: 9 }),
    )
    expect(result.ok && [result.data.cycleIdcToIfr, result.data.cycleIfrToRetcom, result.data.cycleRetcomToIfc]).toEqual([
      5, 12, 9,
    ])
  })

  it('rejects a payload with no project id', () => {
    expect(parseEnableProjectMdrInput({})).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseEnableProjectMdrInput({ projectId: 'not-a-uuid' })).toMatchObject({
      ok: false,
      error: 'invalid_input',
    })
  })

  it.each([0, -1, 1.5])('rejects a cycle of %s days', (value) => {
    expect(parseEnableProjectMdrInput(minimalInput({ cycleIdcToIfr: value }))).toMatchObject({
      ok: false,
      error: 'invalid_cycle',
    })
  })

  it('rejects a negative budget and accepts zero', () => {
    expect(parseEnableProjectMdrInput(minimalInput({ budgetHours: -1 }))).toMatchObject({
      ok: false,
      error: 'invalid_budget',
    })
    expect(parseEnableProjectMdrInput(minimalInput({ budgetHours: 0 })).ok).toBe(true)
  })

  describe('roles', () => {
    it('rejects a role outside the dcs.project_role enum', () => {
      expect(
        parseEnableProjectMdrInput(minimalInput({ roles: [{ userId: USER_ID, role: 'boss' }] })),
      ).toMatchObject({ ok: false, error: 'invalid_input' })
    })

    it('keeps two different roles for the same person — dcs.project_roles is one row per pair', () => {
      const result = parseEnableProjectMdrInput(
        minimalInput({
          roles: [
            { userId: USER_ID, role: 'dc' },
            { userId: USER_ID, role: 'chk' },
          ],
        }),
      )
      expect(result.ok && result.data.roles).toHaveLength(2)
    })

    it('collapses a repeated (user, role) pair rather than letting UNIQUE reject the whole enable call', () => {
      const result = parseEnableProjectMdrInput(
        minimalInput({
          roles: [
            { userId: USER_ID, role: 'dc' },
            { userId: USER_ID, role: 'dc' },
          ],
        }),
      )
      expect(result.ok && result.data.roles).toEqual([{ userId: USER_ID, role: 'dc' }])
    })

    it('accepts an empty team — "at least one DC" is a wizard rule, not a parser rule', () => {
      expect(parseEnableProjectMdrInput(minimalInput({ roles: [] })).ok).toBe(true)
    })
  })

  it('rejects a non-object payload', () => {
    expect(parseEnableProjectMdrInput(null)).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseEnableProjectMdrInput('SC2601')).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})

// ---------------------------------------------------------------------------
// parseUpdateProjectMdrInput
// ---------------------------------------------------------------------------

describe('parseUpdateProjectMdrInput', () => {
  it('drops a projectCode key present in a raw payload', () => {
    // Not merely unused by the type: project_code is the first segment of
    // every document number, so the update path must not accept one even
    // from a hand-made call (same pattern as parseUpdateClientInput).
    const result = parseUpdateProjectMdrInput({ projectId: PROJECT_ID, projectCode: 'SC9999', name: 'Beta' })
    expect(result.ok).toBe(true)
    expect(result.ok && 'projectCode' in result.data).toBe(false)
  })

  it('leaves omitted fields undefined so the diff can tell "unchanged" from "cleared"', () => {
    const result = parseUpdateProjectMdrInput({ projectId: PROJECT_ID, name: 'Beta' })
    expect(result.ok && result.data).toEqual({ projectId: PROJECT_ID, name: 'Beta' })
    expect(result.ok && result.data.budgetHours).toBeUndefined()
  })

  it('keeps an explicit null as "clear this field"', () => {
    const result = parseUpdateProjectMdrInput({ projectId: PROJECT_ID, budgetHours: null, clientId: null })
    expect(result.ok && result.data.budgetHours).toBeNull()
    expect(result.ok && result.data.clientId).toBeNull()
  })

  it('treats processType null as "clear to not classified", not as absent', () => {
    // public.projects.process_type is nullable and the 20260902114743
    // backfill deliberately left every SCYYNN code unclassified, so the
    // dialog's "Not classified" option has to be able to put it back.
    const result = parseUpdateProjectMdrInput({ projectId: PROJECT_ID, processType: null })
    expect(result.ok && result.data.processType).toBeNull()
    expect(result.ok && 'processType' in result.data).toBe(true)
  })

  it('rejects switching a project to internal while keeping its client', () => {
    expect(
      parseUpdateProjectMdrInput({ projectId: PROJECT_ID, processType: 'internal', clientId: CLIENT_ID }),
    ).toMatchObject({ ok: false, error: 'internal_project_has_client' })
  })

  it('rejects an unknown MDR status', () => {
    expect(parseUpdateProjectMdrInput({ projectId: PROJECT_ID, status: 'archived' })).toMatchObject({
      ok: false,
      error: 'invalid_input',
    })
  })
})

// ---------------------------------------------------------------------------
// mapDbError — two constraints share each SQLSTATE, so the name is what counts
// ---------------------------------------------------------------------------

describe('mapDbError', () => {
  it('tells "already enabled" apart from a generic 23505', () => {
    expect(
      mapDbError('23505', 'dcs_enable_project_mdr: DCS is already enabled for project ffffffff-…'),
    ).toMatchObject({ error: 'already_enabled' })
    expect(mapDbError('23505', 'duplicate key value violates unique constraint "something_else"')).toMatchObject({
      error: 'db_error',
    })
  })

  it('tells a bad cycle from a bad budget, both 23514', () => {
    expect(mapDbError('23514', 'violates check constraint "mdr_settings_cycle_idc_to_ifr_positive"')).toMatchObject(
      { error: 'invalid_cycle' },
    )
    expect(
      mapDbError('23514', 'violates check constraint "mdr_settings_budget_hours_non_negative"'),
    ).toMatchObject({ error: 'invalid_budget' })
    expect(mapDbError('23514', 'some other check')).toMatchObject({ error: 'db_error' })
  })

  it('maps the function-raised codes', () => {
    expect(mapDbError('42501', 'only an administrator…')).toMatchObject({ error: 'forbidden' })
    expect(mapDbError('P0002', 'no project with id …')).toMatchObject({ error: 'not_found' })
    expect(mapDbError('22023', 'CPY numbering needs a client…')).toMatchObject({ error: 'cpy_needs_client' })
    expect(mapDbError('23503', 'violates foreign key constraint')).toMatchObject({ error: 'unknown_user' })
  })
})

// ---------------------------------------------------------------------------
// getProjectsWithoutMdr — every project not yet in dcs.mdr_settings
// ---------------------------------------------------------------------------

describe('getProjectsWithoutMdr', () => {
  it('excludes a project already in dcs.mdr_settings', async () => {
    const enabled = makeProject({ id: 'enabled-id', project_code: 'SC0001' })
    const notEnabled = makeProject({ id: 'not-enabled-id', project_code: 'SC0002' })
    const { client } = stubClient({
      projectsList: [enabled, notEnabled],
      mdrProjectIds: ['enabled-id'],
    })
    const result = await getProjectsWithoutMdr(client)
    expect(result).toEqual([
      {
        id: 'not-enabled-id',
        projectCode: 'SC0002',
        name: notEnabled.name,
        clientId: notEnabled.client_id,
        processType: notEnabled.process_type,
        year: notEnabled.year,
      },
    ])
  })

  it('returns every project when none has DCS enabled', async () => {
    const p1 = makeProject({ id: 'p1' })
    const p2 = makeProject({ id: 'p2' })
    const { client } = stubClient({ projectsList: [p1, p2], mdrProjectIds: [] })
    const result = await getProjectsWithoutMdr(client)
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

// ---------------------------------------------------------------------------
// enableProjectMdr — the guard, and the shape of the single RPC
// ---------------------------------------------------------------------------

describe('enableProjectMdr', () => {
  it('refuses a non-admin before issuing any call at all', async () => {
    const { client, rpc } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee' })
    const result = await enableProjectMdr(client, minimalInput())
    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a caller with no session', async () => {
    const { client, rpc } = stubClient({ sessionUserId: null })
    expect(await enableProjectMdr(client, minimalInput())).toEqual({ ok: false, error: 'unauthenticated' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('validates before calling, so a bad payload never reaches the database', async () => {
    const { client, rpc } = stubClient({})
    expect(await enableProjectMdr(client, minimalInput({ cycleIdcToIfr: 0 }))).toMatchObject({
      ok: false,
      error: 'invalid_cycle',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('makes exactly ONE call — the whole point of the function is that this is one transaction', async () => {
    const { client, rpc } = stubClient({})
    const result = await enableProjectMdr(
      client,
      minimalInput({
        cpyNumbering: true,
        cycleIdcToIfr: 5,
        cycleIfrToRetcom: 12,
        cycleRetcomToIfc: 9,
        budgetHours: 1500,
        roles: [{ userId: USER_ID, role: 'dc' }],
      }),
    )
    expect(result).toEqual({ ok: true, data: PROJECT_ID })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('dcs_enable_project_mdr', {
      p_project_id: PROJECT_ID,
      p_cpy_numbering: true,
      p_cycle_idc_to_ifr: 5,
      p_cycle_ifr_to_retcom: 12,
      p_cycle_retcom_to_ifc: 9,
      p_budget_hours: 1500,
      p_roles: [{ user_id: USER_ID, role: 'dc' }],
    })
  })

  it('surfaces the database refusal rather than swallowing it', async () => {
    const { client } = stubClient({
      rpcResult: {
        data: null,
        error: { code: '23505', message: 'dcs_enable_project_mdr: DCS is already enabled for project ffffffff-…' },
      },
    })
    expect(await enableProjectMdr(client, minimalInput())).toMatchObject({ ok: false, error: 'already_enabled' })
  })
})

// ---------------------------------------------------------------------------
// updateProjectMdr — diff-only, across two tables
// ---------------------------------------------------------------------------

describe('updateProjectMdr (diff-only)', () => {
  it('refuses a non-admin without touching either table', async () => {
    const { client, projectUpdates, settingsUpdates } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee' })
    expect(await updateProjectMdr(client, { projectId: PROJECT_ID, name: 'Beta' })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(projectUpdates).toEqual([])
    expect(settingsUpdates).toEqual([])
  })

  it('issues NO statement at all when every field matches the stored row', async () => {
    // On dcs.mdr_settings this is the whole ballgame: a no-op UPDATE still
    // fires set_updated_at() and moves updated_at, and audit_log (which does
    // not cover that table) cannot witness the difference.
    const { client, projectUpdates, settingsUpdates } = stubClient({})
    const result = await updateProjectMdr(client, {
      projectId: PROJECT_ID,
      name: 'Alpha',
      clientId: CLIENT_ID,
      processType: 'project',
      year: 2026,
      cpyNumbering: false,
      cycleIdcToIfr: 7,
      cycleIfrToRetcom: 10,
      cycleRetcomToIfc: 7,
      budgetHours: 1000,
      status: 'active',
    })
    expect(result.ok).toBe(true)
    expect(projectUpdates).toEqual([])
    expect(settingsUpdates).toEqual([])
  })

  it('writes only the changed column when a cycle moves — and touches public.projects not at all', async () => {
    const { client, projectUpdates, settingsUpdates } = stubClient({})
    await updateProjectMdr(client, {
      projectId: PROJECT_ID,
      name: 'Alpha',
      clientId: CLIENT_ID,
      processType: 'project',
      year: 2026,
      cpyNumbering: false,
      cycleIdcToIfr: 14,
      cycleIfrToRetcom: 10,
      cycleRetcomToIfc: 7,
      budgetHours: 1000,
      status: 'active',
    })
    expect(settingsUpdates).toEqual([{ cycle_idc_to_ifr: 14 }])
    expect(projectUpdates).toEqual([])
  })

  it('writes only the changed column when the client moves — and touches mdr_settings not at all', async () => {
    const { client, projectUpdates, settingsUpdates } = stubClient({})
    await updateProjectMdr(client, { projectId: PROJECT_ID, clientId: null })
    expect(projectUpdates).toEqual([{ client_id: null }])
    expect(settingsUpdates).toEqual([])
  })

  it('writes only budget_hours when only the budget moves', async () => {
    const { client, projectUpdates, settingsUpdates } = stubClient({})
    await updateProjectMdr(client, { projectId: PROJECT_ID, budgetHours: 2000 })
    expect(settingsUpdates).toEqual([{ budget_hours: 2000 }])
    expect(projectUpdates).toEqual([])
  })

  it('patches both tables when fields on both changed, still one column each', async () => {
    const { client, projectUpdates, settingsUpdates } = stubClient({})
    await updateProjectMdr(client, { projectId: PROJECT_ID, name: 'Beta', status: 'closed' })
    expect(projectUpdates).toEqual([{ name: 'Beta' }])
    expect(settingsUpdates).toEqual([{ status: 'closed' }])
  })

  it('refuses to add a client to a project that is already internal', async () => {
    // The stored row says internal and the edit only mentions the client, so
    // parseUpdateProjectMdrInput cannot see the conflict — updateProjectMdr
    // evaluates the rule against the row as it would be after the edit.
    const { client, projectUpdates } = stubClient({
      project: makeProject({ process_type: 'internal', client_id: null }),
    })
    expect(await updateProjectMdr(client, { projectId: PROJECT_ID, clientId: CLIENT_ID })).toMatchObject({
      ok: false,
      error: 'internal_project_has_client',
    })
    expect(projectUpdates).toEqual([])
  })

  it('clears process_type when the edit sets it to null', async () => {
    const { client, projectUpdates } = stubClient({})
    const result = await updateProjectMdr(client, { projectId: PROJECT_ID, processType: null })
    expect(result.ok).toBe(true)
    expect(projectUpdates).toEqual([{ process_type: null }])
  })

  it('checks the internal rule against the process type AFTER the edit, not before', async () => {
    // Clearing an internal project's type while giving it a client is legal —
    // it stops being internal. A `??` here would compare against the old
    // 'internal' and refuse it.
    const { client, projectUpdates } = stubClient({
      project: makeProject({ process_type: 'internal', client_id: null }),
    })
    const result = await updateProjectMdr(client, { projectId: PROJECT_ID, processType: null, clientId: CLIENT_ID })
    expect(result.ok).toBe(true)
    expect(projectUpdates).toEqual([{ client_id: CLIENT_ID, process_type: null }])
  })

  it('will not enrol a project into DCS through an edit when it has no mdr_settings row', async () => {
    const { client, settingsUpdates } = stubClient({ settings: null })
    expect(await updateProjectMdr(client, { projectId: PROJECT_ID, budgetHours: 10 })).toMatchObject({
      ok: false,
      error: 'not_found',
    })
    expect(settingsUpdates).toEqual([])
  })

  it('still edits the projects half of a project DCS does not run', async () => {
    const { client, projectUpdates } = stubClient({ settings: null })
    const result = await updateProjectMdr(client, { projectId: PROJECT_ID, name: 'Beta' })
    expect(result.ok).toBe(true)
    expect(projectUpdates).toEqual([{ name: 'Beta' }])
  })

  it('reports a missing project rather than writing blind', async () => {
    const { client } = stubClient({ project: null })
    expect(await updateProjectMdr(client, { projectId: PROJECT_ID, name: 'Beta' })).toMatchObject({
      ok: false,
      error: 'not_found',
    })
  })
})
