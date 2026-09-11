import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  DEFAULT_CYCLE,
  createProjectMdr,
  duplicateCtrCodes,
  hasDocController,
  isValidProjectCode,
  mapDbError,
  parseCreateProjectMdrInput,
  parseUpdateProjectMdrInput,
  skipsClientStep,
  updateProjectMdr,
  type CreateProjectMdrInput,
  type MdrSettingsRow,
  type ProjectRow,
} from './project-mdr'

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EMPLOYEE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PROJECT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CLIENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** The smallest payload the wizard can submit: step 1 filled, everything else default. */
function minimalInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { projectCode: 'SC2601', name: 'Alpha', processType: 'project', year: 2026, ...overrides }
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
}) {
  const {
    sessionUserId = ADMIN,
    role = 'admin',
    project = makeProject(),
    settings = makeSettings(),
    rpcResult = { data: PROJECT_ID, error: null },
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
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: project, error: null }) }) }),
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
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: settings, error: null }) }) }),
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

describe('isValidProjectCode', () => {
  // Mirrors projects_project_code_format (migration 20260901082600) disjunct
  // for disjunct — if this table and the CHECK ever disagree, the wizard
  // either blocks a legal code or lets the database reject one mid-submit.
  it.each([
    ['SC2601', true],
    ['SC9999', true],
    ['SCMS', true],
    ['SCMS-IT', true],
    ['SCMS_TEST', true],
    ['SCC005', true], // named legacy exception, never a pattern (O-11)
  ])('accepts %s', (code, expected) => {
    expect(isValidProjectCode(code as string)).toBe(expected)
  })

  it.each([
    ['SC260', 'too few digits'],
    ['SC26011', 'too many digits'],
    ['SC26O1', 'letter O instead of zero'],
    ['sc2601', 'lowercase'],
    ['SCC006', 'SCC is not a pattern — only SCC005 is grandfathered'],
    ['ASC2601', 'not anchored at the start'],
    ['', 'empty'],
  ])('rejects %s (%s)', (code) => {
    expect(isValidProjectCode(code as string)).toBe(false)
  })
})

describe('duplicateCtrCodes', () => {
  it('returns nothing when every code is distinct', () => {
    expect(duplicateCtrCodes(['SC2601_CTR100', 'SC2601_CTR200'])).toEqual([])
  })

  it('names each repeated code once, in first-seen order', () => {
    expect(duplicateCtrCodes(['A', 'B', 'A', 'C', 'B', 'A'])).toEqual(['A', 'B'])
  })

  it('compares exactly, because sub_projects_project_id_code_key does', () => {
    // A case-insensitive check here would block a payload the database
    // accepts — CTR100 and ctr100 are two distinct rows to Postgres.
    expect(duplicateCtrCodes(['CTR100', 'ctr100'])).toEqual([])
  })
})

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
// parseCreateProjectMdrInput
// ---------------------------------------------------------------------------

describe('parseCreateProjectMdrInput', () => {
  it('accepts a minimal payload and applies the 7/10/7 cycle defaults', () => {
    const result = parseCreateProjectMdrInput(minimalInput())
    expect(result.ok).toBe(true)
    const data = (result as { ok: true; data: CreateProjectMdrInput }).data
    expect(data.cycleIdcToIfr).toBe(DEFAULT_CYCLE.idcToIfr)
    expect(data.cycleIfrToRetcom).toBe(DEFAULT_CYCLE.ifrToRetcom)
    expect(data.cycleRetcomToIfc).toBe(DEFAULT_CYCLE.retcomToIfc)
    expect([data.cycleIdcToIfr, data.cycleIfrToRetcom, data.cycleRetcomToIfc]).toEqual([7, 10, 7])
    expect(data.clientId).toBeNull()
    expect(data.cpyNumbering).toBe(false)
    expect(data.budgetHours).toBeNull()
    expect(data.roles).toEqual([])
    expect(data.ctrCodes).toEqual([])
  })

  it('keeps explicit cycle lengths instead of the defaults', () => {
    const result = parseCreateProjectMdrInput(
      minimalInput({ cycleIdcToIfr: 5, cycleIfrToRetcom: 12, cycleRetcomToIfc: 9 }),
    )
    expect(result.ok && [result.data.cycleIdcToIfr, result.data.cycleIfrToRetcom, result.data.cycleRetcomToIfc]).toEqual([
      5, 12, 9,
    ])
  })

  it('rejects an off-format project code with the error that names the step', () => {
    const result = parseCreateProjectMdrInput(minimalInput({ projectCode: 'NOPE01' }))
    expect(result).toMatchObject({ ok: false, error: 'invalid_project_code' })
  })

  it('trims and upper-cases nothing it was not given — the code is taken as typed, only trimmed', () => {
    const result = parseCreateProjectMdrInput(minimalInput({ projectCode: '  SC2601  ' }))
    expect(result.ok && result.data.projectCode).toBe('SC2601')
  })

  it.each([0, -1, 1.5])('rejects a cycle of %s days', (value) => {
    expect(parseCreateProjectMdrInput(minimalInput({ cycleIdcToIfr: value }))).toMatchObject({
      ok: false,
      error: 'invalid_cycle',
    })
  })

  it('rejects a negative budget and accepts zero', () => {
    expect(parseCreateProjectMdrInput(minimalInput({ budgetHours: -1 }))).toMatchObject({
      ok: false,
      error: 'invalid_budget',
    })
    expect(parseCreateProjectMdrInput(minimalInput({ budgetHours: 0 })).ok).toBe(true)
  })

  describe('internal projects have no client', () => {
    it('rejects an internal project carrying a client id', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({ processType: 'internal', clientId: CLIENT_ID }),
      )
      expect(result).toMatchObject({ ok: false, error: 'internal_project_has_client' })
    })

    it('rejects an internal project with CPY numbering on', () => {
      const result = parseCreateProjectMdrInput(minimalInput({ processType: 'internal', cpyNumbering: true }))
      expect(result).toMatchObject({ ok: false, error: 'internal_project_has_client' })
    })

    it('accepts an internal project with client_id null and cpy_numbering false', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({ processType: 'internal', clientId: null, cpyNumbering: false }),
      )
      expect(result.ok).toBe(true)
      expect(result.ok && result.data.clientId).toBeNull()
      expect(result.ok && result.data.cpyNumbering).toBe(false)
    })

    it('lets a non-internal project have no client — client_id stays nullable', () => {
      expect(parseCreateProjectMdrInput(minimalInput({ processType: 'tender', clientId: null })).ok).toBe(true)
    })
  })

  describe('CTR codes', () => {
    it('rejects a payload with the same CTR code twice, and names it', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({
          ctrCodes: [{ code: 'SC2601_CTR100' }, { code: 'SC2601_CTR200' }, { code: 'SC2601_CTR100' }],
        }),
      )
      expect(result).toMatchObject({ ok: false, error: 'duplicate_ctr_code' })
      expect(result.ok === false && result.message).toContain('SC2601_CTR100')
      expect(result.ok === false && result.message).not.toContain('SC2601_CTR200')
    })

    it('catches a duplicate that only trimming makes identical', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({ ctrCodes: [{ code: 'SC2601_CTR100' }, { code: '  SC2601_CTR100  ' }] }),
      )
      expect(result).toMatchObject({ ok: false, error: 'duplicate_ctr_code' })
    })

    it('stores an empty or missing description as null, not an empty string', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({ ctrCodes: [{ code: 'A', description: '   ' }, { code: 'B' }] }),
      )
      expect(result.ok && result.data.ctrCodes).toEqual([
        { code: 'A', description: null },
        { code: 'B', description: null },
      ])
    })

    it('rejects an empty CTR code', () => {
      expect(parseCreateProjectMdrInput(minimalInput({ ctrCodes: [{ code: '  ' }] }))).toMatchObject({
        ok: false,
        error: 'invalid_input',
      })
    })
  })

  describe('roles', () => {
    it('rejects a role outside the dcs.project_role enum', () => {
      expect(
        parseCreateProjectMdrInput(minimalInput({ roles: [{ userId: USER_ID, role: 'boss' }] })),
      ).toMatchObject({ ok: false, error: 'invalid_input' })
    })

    it('keeps two different roles for the same person — dcs.project_roles is one row per pair', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({
          roles: [
            { userId: USER_ID, role: 'dc' },
            { userId: USER_ID, role: 'chk' },
          ],
        }),
      )
      expect(result.ok && result.data.roles).toHaveLength(2)
    })

    it('collapses a repeated (user, role) pair rather than letting UNIQUE reject the whole creation', () => {
      const result = parseCreateProjectMdrInput(
        minimalInput({
          roles: [
            { userId: USER_ID, role: 'dc' },
            { userId: USER_ID, role: 'dc' },
          ],
        }),
      )
      expect(result.ok && result.data.roles).toEqual([{ userId: USER_ID, role: 'dc' }])
    })
  })

  it('rejects a non-object payload', () => {
    expect(parseCreateProjectMdrInput(null)).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(parseCreateProjectMdrInput('SC2601')).toMatchObject({ ok: false, error: 'invalid_input' })
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
  it('tells a duplicate CTR code from a duplicate project code, both 23505', () => {
    expect(
      mapDbError('23505', 'duplicate key value violates unique constraint "sub_projects_project_id_code_key"'),
    ).toMatchObject({ error: 'duplicate_ctr_code' })
    expect(
      mapDbError('23505', 'duplicate key value violates unique constraint "unique_project_code"'),
    ).toMatchObject({ error: 'duplicate_project_code' })
  })

  it('tells a bad project code from a bad cycle or budget, all 23514', () => {
    expect(mapDbError('23514', 'violates check constraint "projects_project_code_format"')).toMatchObject({
      error: 'invalid_project_code',
    })
    expect(mapDbError('23514', 'violates check constraint "mdr_settings_cycle_idc_to_ifr_positive"')).toMatchObject(
      { error: 'invalid_cycle' },
    )
    expect(
      mapDbError('23514', 'violates check constraint "mdr_settings_budget_hours_non_negative"'),
    ).toMatchObject({ error: 'invalid_budget' })
  })

  it('does not guess at an unrecognised constraint', () => {
    expect(mapDbError('23505', 'duplicate key value violates unique constraint "something_else"')).toMatchObject({
      error: 'db_error',
    })
  })

  it('maps the function-raised codes', () => {
    expect(mapDbError('42501', 'only an administrator…')).toMatchObject({ error: 'forbidden' })
    expect(mapDbError('22023', 'an internal project has no client…')).toMatchObject({
      error: 'internal_project_has_client',
    })
    expect(mapDbError('23503', 'violates foreign key constraint')).toMatchObject({ error: 'unknown_user' })
  })
})

// ---------------------------------------------------------------------------
// createProjectMdr — the guard, and the shape of the single RPC
// ---------------------------------------------------------------------------

describe('createProjectMdr', () => {
  it('refuses a non-admin before issuing any call at all', async () => {
    const { client, rpc } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee' })
    const result = await createProjectMdr(client, minimalInput())
    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a caller with no session', async () => {
    const { client, rpc } = stubClient({ sessionUserId: null })
    expect(await createProjectMdr(client, minimalInput())).toEqual({ ok: false, error: 'unauthenticated' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('validates before calling, so a bad payload never reaches the database', async () => {
    const { client, rpc } = stubClient({})
    expect(await createProjectMdr(client, minimalInput({ projectCode: 'NOPE01' }))).toMatchObject({
      ok: false,
      error: 'invalid_project_code',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('makes exactly ONE call — the whole point of the function is that this is one transaction', async () => {
    const { client, rpc } = stubClient({})
    const result = await createProjectMdr(
      client,
      minimalInput({
        clientId: CLIENT_ID,
        cpyNumbering: true,
        cycleIdcToIfr: 5,
        cycleIfrToRetcom: 12,
        cycleRetcomToIfc: 9,
        budgetHours: 1500,
        roles: [{ userId: USER_ID, role: 'dc' }],
        ctrCodes: [{ code: 'SC2601_CTR100', description: 'PM' }],
      }),
    )
    expect(result).toEqual({ ok: true, data: PROJECT_ID })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('dcs_create_project_mdr', {
      p_project_code: 'SC2601',
      p_name: 'Alpha',
      p_process_type: 'project',
      p_year: 2026,
      p_client_id: CLIENT_ID,
      p_cpy_numbering: true,
      p_cycle_idc_to_ifr: 5,
      p_cycle_ifr_to_retcom: 12,
      p_cycle_retcom_to_ifc: 9,
      p_budget_hours: 1500,
      p_roles: [{ user_id: USER_ID, role: 'dc' }],
      p_ctr_codes: [{ code: 'SC2601_CTR100', description: 'PM' }],
    })
  })

  it('surfaces the database refusal rather than swallowing it', async () => {
    const { client } = stubClient({
      rpcResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "sub_projects_project_id_code_key"' },
      },
    })
    expect(await createProjectMdr(client, minimalInput())).toMatchObject({ ok: false, error: 'duplicate_ctr_code' })
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
