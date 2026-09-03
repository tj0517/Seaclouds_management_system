import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

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

  // Skeleton-only RLS probe — removal is docs/deferred-tasks.md point g)
  // (condition: first dcs.* table with its own policies; the proof moves
  // there). Breaks the "DCS does not read TES tables" rule on purpose, as
  // timesheet_entries is currently the only table whose SELECT policy
  // filters by auth.uid(). The query has NO filter in code — any difference
  // between users in what comes back is produced solely by RLS in the
  // database.
  const { data: rlsProbe, error: rlsProbeError } = await supabase
    .from('timesheet_entries')
    .select('id, user_id')

  if (rlsProbeError) {
    throw new Error(`RLS probe failed: ${rlsProbeError.message}`)
  }
  const probeUserCount = new Set(rlsProbe.map((row) => row.user_id)).size

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SCL DCS</h1>
          <p className="text-sm text-gray-500">
            Signed in as {profile?.full_name ?? user.email} ({profile?.role ?? 'unknown role'})
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <h2 className="mb-1 text-lg font-semibold">Projects</h2>
      <p className="mb-3 text-xs text-gray-500">
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
        <h2 className="text-sm font-semibold text-blue-900">
          RLS probe (skeleton only): timesheet_entries
        </h2>
        <p className="mt-1 text-sm text-blue-900">
          Unfiltered <code className="font-mono">select</code> returned{' '}
          <strong>{rlsProbe.length}</strong> row(s) belonging to{' '}
          <strong>{probeUserCount}</strong> user(s). The query has no filter in
          code — row visibility is enforced entirely by the database.
        </p>
      </section>
    </main>
  )
}
