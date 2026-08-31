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

  // `projects` itself is readable by every authenticated user (inherited TES
  // policy), so per-user filtering comes from RLS on `project_assignments`:
  // the !inner embed drops projects with no assignment rows visible to the
  // current session. Members see their projects, admins see all assigned ones.
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, description, project_code, is_active, project_assignments!inner(user_id)')
    .order('name')

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`)
  }

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

      <h2 className="mb-3 text-lg font-semibold">Your projects</h2>
      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">
          You are not assigned to any project.
        </p>
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
    </main>
  )
}
