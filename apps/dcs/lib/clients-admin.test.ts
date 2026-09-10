import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import {
  createClient,
  getActiveClients,
  parseCreateClientInput,
  parseSetClientActiveInput,
  parseUpdateClientInput,
  setClientActive,
  updateClient,
  visibleClients,
  type ClientRow,
} from './clients-admin'

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const EMPLOYEE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const ROW_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function makeRow(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: ROW_ID,
    name: 'Acme Industries',
    code: 'ACME',
    contact_email: 'contact@acme.example',
    notes: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Stubs the exact chains lib/clients-admin.ts issues: auth.getUser(),
 * profiles.select().eq().single() (the guard's role read — deliberately no
 * dcs.project_roles read at all, unlike dictionaries-admin.test.ts's stub,
 * because requireAdmin has no DC branch), and clients insert/select/update
 * for the three mutations.
 */
function stubClient(opts: { sessionUserId: string; role: 'admin' | 'employee'; currentRow?: ClientRow | null }) {
  const { sessionUserId, role, currentRow = null } = opts

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
      order: () => Promise.resolve({ data: currentRow ? [currentRow] : [], error: null }),
    }),
  }))

  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { role }, error: null }) }) }) }
    }
    if (table === 'clients') {
      return { insert: insertMock, update: updateMock, select: selectCurrentRowMock }
    }
    throw new Error(`unexpected public.from(${table})`)
  })

  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: sessionUserId } } }) },
    from,
  } as unknown as SupabaseClient<Database>

  return { client, insertMock, updateMock }
}

describe('parseCreateClientInput', () => {
  it('accepts a valid client', () => {
    expect(parseCreateClientInput({ name: ' Acme ', code: 'ACME' })).toEqual({
      name: 'Acme',
      code: 'ACME',
      contactEmail: null,
      notes: null,
    })
  })

  it('rejects an empty name', () => {
    expect(parseCreateClientInput({ name: '  ', code: 'ACME' })).toBeNull()
  })

  it('rejects a code with a hyphen', () => {
    expect(parseCreateClientInput({ name: 'Acme', code: 'AC-ME' })).toBeNull()
  })

  it('rejects a code shorter than 2 chars', () => {
    expect(parseCreateClientInput({ name: 'Acme', code: 'A' })).toBeNull()
  })

  it('rejects a code longer than 10 chars', () => {
    expect(parseCreateClientInput({ name: 'Acme', code: 'ABCDEFGHIJK' })).toBeNull()
  })

  it('rejects a lowercase code', () => {
    expect(parseCreateClientInput({ name: 'Acme', code: 'acme' })).toBeNull()
  })
})

describe('parseUpdateClientInput', () => {
  it('ignores a code field present in the raw payload', () => {
    const parsed = parseUpdateClientInput({ id: ROW_ID, name: 'New name', code: 'HACKED' })
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('code')
  })

  it('rejects a non-UUID id', () => {
    expect(parseUpdateClientInput({ id: 'not-a-uuid', name: 'X' })).toBeNull()
  })

  it('leaves name/contactEmail/notes undefined when omitted', () => {
    expect(parseUpdateClientInput({ id: ROW_ID })).toEqual({
      id: ROW_ID,
      name: undefined,
      contactEmail: undefined,
      notes: undefined,
    })
  })

  it('treats an explicit null contactEmail as "clear"', () => {
    const parsed = parseUpdateClientInput({ id: ROW_ID, contactEmail: null })
    expect(parsed?.contactEmail).toBeNull()
  })
})

describe('parseSetClientActiveInput', () => {
  it('accepts a valid payload', () => {
    expect(parseSetClientActiveInput({ id: ROW_ID, isActive: false })).toEqual({ id: ROW_ID, isActive: false })
  })

  it('rejects a non-boolean isActive', () => {
    expect(parseSetClientActiveInput({ id: ROW_ID, isActive: 'false' })).toBeNull()
  })
})

describe('mutation guard (admin-only, no DC bypass)', () => {
  it('createClient rejects a plain employee', async () => {
    const { client } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee' })
    const result = await createClient(client, { name: 'Acme', code: 'ACME' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('createClient rejects a non-admin who holds a dc role elsewhere', async () => {
    // requireAdmin never reads dcs.project_roles at all — the stub's `from`
    // throws on any table other than `profiles`/`clients`, so this also
    // proves no DC lookup happens on the way to the forbidden verdict.
    const { client } = stubClient({ sessionUserId: DC, role: 'employee' })
    const result = await createClient(client, { name: 'Acme', code: 'ACME' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('updateClient rejects a plain employee', async () => {
    const { client } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee', currentRow: makeRow() })
    const result = await updateClient(client, { id: ROW_ID, name: 'New name' })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('setClientActive rejects a plain employee', async () => {
    const { client } = stubClient({ sessionUserId: EMPLOYEE, role: 'employee' })
    const result = await setClientActive(client, { id: ROW_ID, isActive: false })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('createClient allows an admin', async () => {
    const { client } = stubClient({ sessionUserId: ADMIN, role: 'admin' })
    const result = await createClient(client, { name: 'Acme', code: 'ACME' })
    expect(result.ok).toBe(true)
  })
})

describe('updateClient: code is immutable', () => {
  it('drops a code field in the raw payload — the stored code is unchanged', async () => {
    const currentRow = makeRow({ code: 'ORIGINAL' })
    const { client, updateMock } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })

    const result = await updateClient(client, {
      id: ROW_ID,
      name: 'New name',
      code: 'HACKED',
    } as unknown as Parameters<typeof updateClient>[1])

    expect(result.ok).toBe(true)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [payload] = updateMock.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('code')
  })
})

describe('updateClient: diff-only', () => {
  it('writes only the field that actually changed', async () => {
    const currentRow = makeRow({ name: 'Acme Industries', contact_email: 'a@a.example', notes: 'old' })
    const { client, updateMock } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })

    await updateClient(client, { id: ROW_ID, name: 'Acme Industries Renamed', contactEmail: 'a@a.example', notes: 'old' })

    expect(updateMock).toHaveBeenCalledTimes(1)
    const [payload] = updateMock.mock.calls[0] as [Record<string, unknown>]
    expect(payload).toEqual({ name: 'Acme Industries Renamed' })
  })

  it('omitting a field leaves it unchanged instead of nulling it', async () => {
    const currentRow = makeRow({ contact_email: 'keep@me.example' })
    const { client, updateMock } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })

    await updateClient(client, { id: ROW_ID, name: currentRow.name })

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('a no-op save (identical values) writes nothing', async () => {
    const currentRow = makeRow()
    const { client, updateMock } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })

    const result = await updateClient(client, {
      id: ROW_ID,
      name: currentRow.name,
      contactEmail: currentRow.contact_email,
      notes: currentRow.notes,
    })

    expect(updateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: currentRow })
  })
})

describe('getActiveClients', () => {
  it('queries active clients ordered by name', async () => {
    const currentRow = makeRow()
    const { client } = stubClient({ sessionUserId: ADMIN, role: 'admin', currentRow })
    const result = await getActiveClients(client)
    expect(result).toEqual([currentRow])
  })
})

// The pure decision behind ClientsTable's "Show inactive" toggle — extracted
// so it is unit-testable under vitest.config.ts's node-only environment
// (DCS 1a.12: no jsdom/RTL in apps/dcs; components stay untested-but-trivial
// wrappers around exported decision functions, see components/IfRole.tsx).
// ClientsTable itself only calls this and renders the result — nothing left
// there worth mounting a component-testing stack for.
describe('visibleClients', () => {
  const active = makeRow({ id: 'active-1', is_active: true })
  const inactive = makeRow({ id: 'inactive-1', is_active: false })

  it('hides inactive clients by default (showInactive=false)', () => {
    expect(visibleClients([active, inactive], false)).toEqual([active])
  })

  it('shows inactive clients, unmodified, when showInactive=true', () => {
    expect(visibleClients([active, inactive], true)).toEqual([active, inactive])
  })

  it('never drops a row from the input — is_active stays false, not deleted', () => {
    const result = visibleClients([active, inactive], true)
    const found = result.find((c) => c.id === 'inactive-1')
    expect(found).toBeDefined()
    expect(found?.is_active).toBe(false)
  })

  it('an all-active list is unaffected by the toggle either way', () => {
    const clients = [active, makeRow({ id: 'active-2', is_active: true })]
    expect(visibleClients(clients, false)).toEqual(clients)
    expect(visibleClients(clients, true)).toEqual(clients)
  })
})
