// DCS 1a.14: user × project × DCS-role matrix, "per user" view — one row per
// project, six-role checkbox group per row, saved via setProjectRoles().
// Admin-only (mirrors apps/timesheet/app/admin/users/[id]: a project's DC
// manages roles from the "per project" view instead, scoped to their own
// project by RLS + requireAdminOrDc — see app/(app)/admin/projects/[projectId]).
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import RoleCheckboxGroup from '@/components/RoleCheckboxGroup'
import { PROJECT_ROLES, type ProjectRole } from '@/lib/project-roles'

export default async function UserRolesPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: sessionProfile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (sessionProfile?.role !== 'admin') redirect('/')

  const [{ data: targetProfile }, { data: projects, error: projectsError }, { data: allRoleRows, error: rolesError }] =
    await Promise.all([
      supabase.from('profiles').select('id, full_name, employee_id').eq('id', userId).maybeSingle(),
      supabase.from('projects').select('id, name, project_code, is_active').order('name'),
      // Unfiltered by project: admin session reads every dcs.project_roles row
      // ("Admins manage project roles"), so this covers the target user's
      // roles AND every project's current DC set in one query.
      supabase.schema('dcs').from('project_roles').select('project_id, user_id, role'),
    ])

  if (!targetProfile) notFound()
  if (projectsError) throw new Error(`Failed to load projects: ${projectsError.message}`)
  if (rolesError) throw new Error(`Failed to load project roles: ${rolesError.message}`)

  const rolesByProjectForUser = new Map<string, ProjectRole[]>()
  const projectsWithDc = new Set<string>()
  for (const row of allRoleRows ?? []) {
    if (row.user_id === userId) {
      const existing = rolesByProjectForUser.get(row.project_id) ?? []
      existing.push(row.role)
      rolesByProjectForUser.set(row.project_id, existing)
    }
    if (row.role === 'dc') projectsWithDc.add(row.project_id)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">DCS roles</h1>
      <p className="mb-6 text-sm text-gray-500">
        {targetProfile.full_name ?? targetProfile.id}
        {targetProfile.employee_id ? ` · ${targetProfile.employee_id}` : ''}
      </p>

      {(projects ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No projects in the system.</p>
      ) : (
        <div className="space-y-3">
          {(projects ?? []).map((project) => (
            <div key={project.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{project.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{project.project_code}</span>
                  {!project.is_active && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">inactive</span>
                  )}
                </div>
                {!projectsWithDc.has(project.id) && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    No Document Controller assigned
                  </span>
                )}
              </div>
              <RoleCheckboxGroup
                projectId={project.id}
                userId={userId}
                initialRoles={rolesByProjectForUser.get(project.id) ?? []}
              />
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-gray-400">Roles: {PROJECT_ROLES.join(', ')}</p>
    </div>
  )
}
