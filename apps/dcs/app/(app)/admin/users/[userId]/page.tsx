// DCS 1a.14: user × project × DCS-role matrix, "per user" view — one row per
// project, six-role checkbox group per row, saved via setProjectRoles().
// Admin-only (mirrors apps/timesheet/app/admin/users/[id]: a project's DC
// manages roles from the "per project" view instead, scoped to their own
// project by RLS + requireAdminOrDc — see app/(app)/admin/projects/[projectId]).
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import RoleCheckboxGroup from '@/components/RoleCheckboxGroup'
import { Badge } from '@/components/ui/badge'
import { EmptyState, PageBody, PageHeader } from '@/components/page-chrome'
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
    <PageBody className="max-w-4xl">
      <PageHeader
        title="DCS roles"
        description={`${targetProfile.full_name ?? targetProfile.id}${
          targetProfile.employee_id ? ` · ${targetProfile.employee_id}` : ''
        }`}
      />

      {(projects ?? []).length === 0 ? (
        <EmptyState title="No projects in the system" />
      ) : (
        <div className="space-y-3">
          {(projects ?? []).map((project) => (
            <div key={project.id} className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{project.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{project.project_code}</span>
                {!project.is_active && (
                  <Badge variant="outline" className="text-muted-foreground">
                    inactive
                  </Badge>
                )}
                {!projectsWithDc.has(project.id) && (
                  <Badge className="ml-auto border-transparent bg-warning-bg text-warning hover:bg-warning-bg">
                    No Document Controller assigned
                  </Badge>
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

      <p className="mt-6 text-xs text-muted-foreground">Roles: {PROJECT_ROLES.join(', ')}</p>
    </PageBody>
  )
}
