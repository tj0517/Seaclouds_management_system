// DCS 1a.21a: route-level tests for the two /admin page guards.
//
// These deliberately go one level above lib/auth-helpers.test.ts, which
// covers the decision (canOpenAdminScreens) in isolation. What can silently
// rot is the *wiring* — a page that computes the right answer and then
// forgets to act on it — so these call the real page functions with a stubbed
// Supabase client and assert on redirect(). No jsdom and no render: an async
// RSC is just an async function, and the guard runs before any JSX is built.
//
// The personas are the scl-dev test accounts from docs/deferred-tasks.md (aa).
import { beforeEach, describe, expect, it, vi } from 'vitest'

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect(${to})`)
  }
}

const redirect = vi.fn((to: string) => {
  throw new RedirectSignal(to)
})

vi.mock('next/navigation', () => ({
  redirect: (to: string) => redirect(to),
  notFound: () => {
    throw new Error('notFound')
  },
}))

// Kept out of the module graph: both are client components pulling in Radix,
// and nothing here renders them.
vi.mock('@/components/ClientsTable', () => ({ default: () => null }))
vi.mock('@/components/DictionariesClient', () => ({ default: () => null }))

type Role = 'admin' | 'employee'
type RoleRow = { project_id: string; role: string }

let projectRoleReads = 0

/**
 * Only the calls these two pages actually make. Anything else throws rather
 * than quietly resolving to undefined — a page that grows a new read should
 * fail loudly here instead of testing a half-stubbed world.
 */
function stubSupabase(opts: { role: Role; roleRows: RoleRow[]; roleReadFails?: boolean }) {
  const ok = (data: unknown) => Promise.resolve({ data, error: null })

  const publicTable = (table: string) => {
    switch (table) {
      case 'profiles':
        return { select: () => ({ eq: () => ({ maybeSingle: () => ok({ role: opts.role }) }) }) }
      case 'clients':
        return { select: () => ({ order: () => ok([]) }) }
      case 'projects':
        return { select: () => ({ not: () => ok([]) }) }
      default:
        throw new Error(`unexpected public.${table}`)
    }
  }

  const dcsTable = (table: string) => {
    switch (table) {
      case 'project_roles':
        return {
          select: () => ({
            eq: () => {
              projectRoleReads += 1
              return opts.roleReadFails
                ? Promise.resolve({ data: null, error: { message: 'connection reset' } })
                : ok(opts.roleRows)
            },
          }),
        }
      case 'dictionaries':
        return { select: () => ({ order: () => ({ order: () => ({ order: () => ok([]) }) }) }) }
      default:
        throw new Error(`unexpected dcs.${table}`)
    }
  }

  return {
    auth: { getUser: () => ok({ user: { id: 'user-1' } }) },
    from: publicTable,
    schema: (name: string) => {
      if (name !== 'dcs') throw new Error(`unexpected schema(${name})`)
      return { from: dcsTable }
    },
  }
}

const createClient = vi.fn()
vi.mock('@scl/db/server', () => ({ createClient: () => createClient() }))

function withSession(opts: { role: Role; roleRows: RoleRow[]; roleReadFails?: boolean }) {
  createClient.mockResolvedValue(stubSupabase(opts))
}

const ADMIN = { role: 'admin' as const, roleRows: [] }
const DC = { role: 'employee' as const, roleRows: [{ project_id: 'p-1', role: 'dc' }] }
const MEMBER = {
  role: 'employee' as const,
  roleRows: [
    { project_id: 'p-1', role: 'orig' },
    { project_id: 'p-1', role: 'view' },
  ],
}

/** Runs a page and reports where (if anywhere) it redirected. */
async function run(page: () => Promise<unknown>): Promise<string | null> {
  try {
    await page()
    return null
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to
    throw error
  }
}

beforeEach(() => {
  redirect.mockClear()
  createClient.mockReset()
  projectRoleReads = 0
})

describe.each([
  ['/admin/dictionaries', async () => (await import('./dictionaries/page')).default],
  ['/admin/clients', async () => (await import('./clients/page')).default],
])('%s page guard', (_route, loadPage) => {
  it('lets an admin through', async () => {
    withSession(ADMIN)
    const Page = await loadPage()
    expect(await run(() => Page())).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('lets the DC of any project through', async () => {
    withSession(DC)
    const Page = await loadPage()
    expect(await run(() => Page())).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects a plain member to /', async () => {
    withSession(MEMBER)
    const Page = await loadPage()
    expect(await run(() => Page())).toBe('/')
    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('redirects a member to / when the project_roles read fails (degrades closed)', async () => {
    withSession({ ...MEMBER, roleReadFails: true })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Page = await loadPage()
    expect(await run(() => Page())).toBe('/')
    logged.mockRestore()
  })

  it('never reads project_roles for an admin', async () => {
    withSession(ADMIN)
    const Page = await loadPage()
    await run(() => Page())
    expect(projectRoleReads).toBe(0)
  })
})
