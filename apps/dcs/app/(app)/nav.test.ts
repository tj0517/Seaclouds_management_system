// DCS 1a.21a: what each persona is *offered* — the sidebar's admin links and
// the per-row "Team" link on the project list.
//
// Neither is an access decision (the page guards and RLS are), but both are
// acceptance criteria for the 1a gate demo, and both are the kind of wiring
// that rots silently: the decision functions in lib/auth-helpers.ts can stay
// correct while a page stops consulting them. Same approach as
// app/(app)/admin/guards.test.ts — call the async RSC, inspect what it
// returned, no jsdom.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ redirect: () => undefined, notFound: () => undefined }))

// Marker components: identity is what the assertions match on.
const SidebarMarker = () => null
const LinkMarker = () => null
vi.mock('@/components/DcsSidebar', () => ({ default: SidebarMarker }))
vi.mock('@/components/ModuleSwitcher', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: LinkMarker }))

type Row = Record<string, unknown>

/** Chainable, awaitable stand-in for one PostgREST query builder. */
function builder(data: unknown) {
  const result = { data, error: null }
  const self: Record<string, unknown> = {
    maybeSingle: () => Promise.resolve(result),
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onOk, onErr),
  }
  for (const method of ['select', 'order', 'in', 'eq', 'not', 'limit']) {
    self[method] = () => self
  }
  return self
}

const PEJ = 'p-pej'
const DEMO = 'p-demo'

function stubSupabase(opts: { role: 'admin' | 'employee'; roleRows: Row[] }) {
  const tables: Record<string, unknown> = {
    profiles: builder({ full_name: 'Test Person', role: opts.role }),
    module_permissions: builder([{ module: 'dcs' }]),
    projects: builder([
      { id: PEJ, name: 'PEJ/131/2026', description: null, project_code: 'SC2602', is_active: true },
      { id: DEMO, name: 'Demo project', description: null, project_code: 'SC2699', is_active: true },
    ]),
  }
  const dcsTables: Record<string, unknown> = {
    project_roles: builder(opts.roleRows),
    mdr_settings: builder([
      { project_id: DEMO, cycle_idc_to_ifr: 7, cycle_ifr_to_retcom: 10, cycle_retcom_to_ifc: 7 },
    ]),
  }
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1', email: 'x@example.com' } } }) },
    from: (t: string) => tables[t] ?? (() => { throw new Error(`unexpected public.${t}`) })(),
    schema: (s: string) => {
      if (s !== 'dcs') throw new Error(`unexpected schema(${s})`)
      return { from: (t: string) => dcsTables[t] ?? (() => { throw new Error(`unexpected dcs.${t}`) })() }
    },
  }
}

const createClient = vi.fn()
vi.mock('@scl/db/server', () => ({ createClient: () => createClient() }))

type Element = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } }

/** Every React element in a returned tree, depth-first. */
function elements(node: unknown, out: Element[] = []): Element[] {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out)
    return out
  }
  const element = node as Element
  if (element.type !== undefined) out.push(element)
  if (element.props && 'children' in element.props) elements(element.props.children, out)
  return out
}

const ADMIN = { role: 'admin' as const, roleRows: [] }
/** dcs1a14-dc: DC of one of the two projects only. */
const DC = { role: 'employee' as const, roleRows: [{ project_id: PEJ, role: 'dc' }] }
/** dcs1a14-member: roles on both projects, DC of neither. */
const MEMBER = {
  role: 'employee' as const,
  roleRows: [
    { project_id: PEJ, role: 'orig' },
    { project_id: DEMO, role: 'orig' },
  ],
}

beforeEach(() => createClient.mockReset())

describe('DcsSidebar admin links (app/(app)/layout.tsx decides)', () => {
  async function canSeeAdminLinks(session: { role: 'admin' | 'employee'; roleRows: Row[] }) {
    createClient.mockResolvedValue(stubSupabase(session))
    const AppLayout = (await import('./layout')).default
    const tree = await AppLayout({ children: null })
    const sidebar = elements(tree).find((element) => element.type === SidebarMarker)
    expect(sidebar, 'DcsSidebar not found in the layout tree').toBeDefined()
    return sidebar?.props?.canSeeAdminLinks
  }

  it('admin sees Dictionaries and Clients', async () => {
    await expect(canSeeAdminLinks(ADMIN)).resolves.toBe(true)
  })

  it('dcs1a14-dc sees Dictionaries and Clients', async () => {
    await expect(canSeeAdminLinks(DC)).resolves.toBe(true)
  })

  it('dcs1a14-member sees neither', async () => {
    await expect(canSeeAdminLinks(MEMBER)).resolves.toBe(false)
  })
})

describe('per-row "Team" link (app/(app)/page.tsx)', () => {
  async function teamLinkTargets(session: { role: 'admin' | 'employee'; roleRows: Row[] }) {
    createClient.mockResolvedValue(stubSupabase(session))
    const ProjectsPage = (await import('./page')).default
    const tree = await ProjectsPage()
    return elements(tree)
      .filter((element) => element.type === LinkMarker && element.props?.children === 'Team')
      .map((element) => element.props?.href)
  }

  it('admin gets a Team link on every row', async () => {
    await expect(teamLinkTargets(ADMIN)).resolves.toEqual([
      `/admin/projects/${PEJ}`,
      `/admin/projects/${DEMO}`,
    ])
  })

  it('dcs1a14-dc gets one only on the project they are DC of', async () => {
    await expect(teamLinkTargets(DC)).resolves.toEqual([`/admin/projects/${PEJ}`])
  })

  it('dcs1a14-member gets none, on either of their projects', async () => {
    await expect(teamLinkTargets(MEMBER)).resolves.toEqual([])
  })
})

describe('the removed RLS probe (deferred-tasks (x), closed by 1a.21a)', () => {
  it('the project list never writes to dcs.mdr_settings', async () => {
    const stub = stubSupabase(ADMIN)
    const settings = stub.schema('dcs').from('mdr_settings') as Record<string, unknown>
    settings.insert = vi.fn(() => {
      throw new Error('the project list must not INSERT into dcs.mdr_settings')
    })
    createClient.mockResolvedValue(stub)

    const ProjectsPage = (await import('./page')).default
    await ProjectsPage()

    expect(settings.insert).not.toHaveBeenCalled()
  })
})

describe('DcsSidebar renders exactly the links it is told to', () => {
  async function navHrefs(canSeeAdminLinks: boolean) {
    // importActual: this file mocks DcsSidebar for the layout tests above,
    // and here we want the real one.
    const { default: DcsSidebar } =
      await vi.importActual<typeof import('@/components/DcsSidebar')>('@/components/DcsSidebar')
    const tree = DcsSidebar({
      email: 'x@example.com',
      fullName: 'Test Person',
      hasTesAccess: false,
      canSeeAdminLinks,
    })
    return elements(tree)
      .filter((element) => element.type === LinkMarker)
      .map((element) => element.props?.href)
  }

  it('offers Projects, MDR, Dictionaries and Clients when allowed', async () => {
    await expect(navHrefs(true)).resolves.toEqual([
      '/',
      '/mdr',
      '/admin/dictionaries',
      '/admin/clients',
    ])
  })

  // DCS 1b.05: MDR stays in the list. It is not an admin screen — /mdr has no
  // page guard at all, because RLS already decides which rows a caller sees,
  // so hiding the link from a non-admin would hide a page they may open.
  it('offers Projects and MDR to everyone else', async () => {
    await expect(navHrefs(false)).resolves.toEqual(['/', '/mdr'])
  })
})
