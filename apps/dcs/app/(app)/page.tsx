import { createClient } from '@scl/db/server'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Layout already guarantees a session; RLS queries below still need the id.
  if (!user) return null

  // Deliberately unfiltered: `projects` carries an inherited TES policy that
  // grants SELECT to every authenticated user, so everyone sees the full list.
  // Per-member visibility for DCS needs a NEW policy (1a.09, on top of
  // dcs.project_roles + has_project_role()) — see docs/02-data-model.md.
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, description, project_code, is_active')
    .order('name')

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`)
  }

  // RLS probe on dcs.mdr_settings — the first dcs.* table with its own
  // policies (deferred-tasks g, closed: this replaced the temporary
  // timesheet_entries probe, so DCS no longer reads TES tables).
  //
  // Read half: a clean select with NO filter in code. The current SELECT
  // policy admits every authenticated user, so identical results for admin
  // and employee are the EXPECTED outcome here — per-member visibility
  // arrives with dcs.project_members (1a.06).
  const { data: mdrSettings, error: mdrError } = await supabase
    .schema('dcs')
    .from('mdr_settings')
    .select('project_id, status, cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc')

  if (mdrError) {
    throw new Error(`RLS probe (select) failed: ${mdrError.message}`)
  }

  // Write half: this is where the database distinguishes the roles. The
  // insert carries cycle_idc_to_ifr = 0, which violates a CHECK, so it can
  // never persist — but the error code tells who was stopped by what:
  // 42501 = RLS rejected the row before constraints ran (non-admin),
  // 23514 = RLS let it through and the CHECK stopped it (admin).
  const { error: writeProbeError } = await supabase
    .schema('dcs')
    .from('mdr_settings')
    .insert({ project_id: projects[0]?.id ?? user.id, cycle_idc_to_ifr: 0 })
  const writeProbeOutcome =
    writeProbeError?.code === '42501'
      ? 'blocked by RLS (42501) — this user cannot write mdr_settings'
      : writeProbeError?.code === '23514'
        ? 'passed RLS, stopped by CHECK (23514) — this user may write mdr_settings'
        : `unexpected: ${writeProbeError ? `${writeProbeError.code} ${writeProbeError.message}` : 'insert succeeded — probe is broken'}`

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">Projects</h1>
      <p className="mb-4 text-xs text-gray-500">
        Unfiltered read of public.projects — the inherited policy shows every
        project to every signed-in user.
      </p>
      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">No projects visible.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-100 text-left">
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 font-mono">{project.project_code ?? '—'}</td>
                <td className="px-4 py-2">
                  {project.name}
                  {project.description ? (
                    <span className="block text-xs text-gray-500">{project.description}</span>
                  ) : null}
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

      <section className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-blue-900">RLS probe: dcs.mdr_settings</h2>
        <p className="mt-1 text-sm text-blue-900">
          Unfiltered <code className="font-mono">select</code> returned{' '}
          <strong>{mdrSettings.length}</strong> row(s). The query has no filter
          in code; the current SELECT policy admits every signed-in user, so
          admin and employee see the same rows by design.
        </p>
        <p className="mt-2 text-sm text-blue-900">
          Write probe (insert that a CHECK always rejects, so it can never
          persist): <strong>{writeProbeOutcome}</strong>. Sign in as an admin
          and as an employee to see the database, not the app, produce the
          difference.
        </p>
      </section>
    </div>
  )
}
