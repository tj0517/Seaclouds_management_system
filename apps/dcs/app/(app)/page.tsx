import Link from 'next/link'
import { createClient } from '@scl/db/server'
import { isAdminOrProjectDc, type ProjectRole } from '@/lib/auth-helpers'
import { resolveProjectListFilter } from '@/lib/project-list'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Layout already guarantees a session; RLS queries below still need the id.
  if (!user) return null

  const { data: sessionProfile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = sessionProfile?.role === 'admin'

  // DCS 1a.14b: public.projects' own SELECT policy ("Widoczność projektów")
  // still admits every signed-in user — that policy is shared, load-bearing
  // Timesheet infrastructure and stays untouched (see the migration comment
  // on public.dcs_profile_directory()). The filter is entirely app-side:
  // admin gets no filter (the policy already shows everyone everything);
  // everyone else is narrowed to projects they hold a dcs.project_roles row
  // on. A member with zero roles gets a clear empty-state message, not an
  // error; a read failure degrades to the same empty list plus its own
  // distinct message (fails closed on purpose — see lib/project-list.ts).
  const filter = await resolveProjectListFilter(supabase, user.id, isAdmin)

  // DCS 1a.21a: the same roles the filter already read, reused to decide
  // which rows get a "Team" link. Empty for an admin — the filter short-
  // circuits before reading roles, and isAdminOrProjectDc never consults the
  // map for one.
  const rolesByProject = filter.kind === 'ids' ? filter.rolesByProject : new Map<string, ProjectRole[]>()

  let projects: {
    id: string
    name: string
    description: string | null
    project_code: string | null
    is_active: boolean | null
  }[] = []
  if (filter.kind === 'all' || (filter.kind === 'ids' && filter.ids.length > 0)) {
    let query = supabase.from('projects').select('id, name, description, project_code, is_active').order('name')
    if (filter.kind === 'ids') query = query.in('id', filter.ids)
    const { data, error } = await query
    if (error) throw new Error(`Failed to load projects: ${error.message}`)
    projects = data ?? []
  }

  // DCS 1a.17, acceptance criterion 2: the DC of a project must see it here
  // "with team and cycle". Both extra reads below are UNFILTERED in code —
  // which rows come back is the database's decision (dcs.project_roles'
  // "Project members read project roles"; mdr_settings' SELECT policy admits
  // any signed-in user), so this stays a valid RLS proof by
  // docs/03-conventions.md's rule.
  const { data: teamRows, error: teamError } = await supabase.schema('dcs').from('project_roles').select('project_id')
  if (teamError) throw new Error(`Failed to load project teams: ${teamError.message}`)
  const teamSizeByProject = new Map<string, number>()
  for (const row of teamRows ?? []) {
    teamSizeByProject.set(row.project_id, (teamSizeByProject.get(row.project_id) ?? 0) + 1)
  }

  // Source of the Cycle column. Unfiltered in code on purpose, same as the
  // team read above: mdr_settings' SELECT policy admits any signed-in user,
  // so the database decides the row set.
  //
  // DCS 1a.21a: this read is all that remains of the "RLS probe" block that
  // lived here from 1a.05 through 1a.17 (deferred-tasks (x), first bullet).
  // The probe's demonstration half — a second, deliberately CHECK-violating
  // INSERT on every render, plus the blue panel reporting its SQLSTATE — is
  // gone: diagnostic UI has no place in front of a client, and the RLS proof
  // it stood for is covered by supabase/tests/rls_mdr_settings.test.sql.
  // Ownership moved from 1b.05 to 1a.21a when the 1a gate demo needed it
  // removed before the MDR register exists.
  const { data: mdrSettings, error: mdrError } = await supabase
    .schema('dcs')
    .from('mdr_settings')
    .select('project_id, cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc')

  if (mdrError) {
    throw new Error(`Failed to load MDR settings: ${mdrError.message}`)
  }

  const settingsByProject = new Map(mdrSettings.map((row) => [row.project_id, row]))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        {isAdmin && (
          <Link
            href="/admin/projects/new"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
          >
            New project MDR
          </Link>
        )}
      </div>
      <p className="mb-4 text-xs text-gray-500">
        {filter.kind === 'all'
          ? 'Every project — you are an admin.'
          : 'Projects where you hold a DCS role.'}
      </p>

      {filter.kind === 'degraded' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&apos;t load your project roles right now — showing no projects. Try refreshing; if this
          persists, contact an admin.
        </div>
      )}
      {filter.kind === 'ids' && filter.ids.length === 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          You have no DCS project roles yet — ask a Document Controller or admin to add you to a project.
        </div>
      )}

      {projects.length === 0 ? null : (
        <table className="w-full border-collapse overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-100 text-left">
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Cycle</th>
              <th className="px-4 py-2 font-medium">Team</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 font-mono">{project.project_code ?? '—'}</td>
                <td className="px-4 py-2">
                  <Link href={`/admin/projects/${project.id}`} className="text-blue-700 hover:underline">
                    {project.name}
                  </Link>
                  {project.description ? (
                    <span className="block text-xs text-gray-500">{project.description}</span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {(() => {
                    const settings = settingsByProject.get(project.id)
                    return settings
                      ? `${settings.cycle_idc_to_ifr}/${settings.cycle_ifr_to_retcom}/${settings.cycle_retcom_to_ifc}`
                      : '—'
                  })()}
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {teamSizeByProject.get(project.id) ?? 0}
                  {/* DCS 1a.21a: an editor's entry point, not an access
                      decision — shown only to whoever may change this
                      project's team (admin, or its own DC), mirroring
                      requireAdminOrDc. The project name beside it already
                      links to the same page for every reader. */}
                  {isAdminOrProjectDc(isAdmin, rolesByProject, project.id) && (
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="ml-2 text-xs font-medium text-blue-700 hover:underline"
                    >
                      Team
                    </Link>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={
                      project.is_active
                        ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800'
                        : 'rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600'
                    }
                  >
                    {project.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
