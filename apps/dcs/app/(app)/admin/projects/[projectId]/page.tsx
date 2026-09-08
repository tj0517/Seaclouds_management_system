// DCS 1a.14: user × project × DCS-role matrix, "per project" view — a team
// table, one row per member, one column group per role. Editable by admin or
// the project's own DC (requireAdminOrDc in lib/project-roles.ts mirrors
// this exactly — RLS is still the last line of defence, see setProjectRoles);
// read-only for every other project member. A non-member sees an empty team
// (dcs.project_roles RLS: "Project members read project roles").
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import AddMemberForm from '@/components/AddMemberForm'
import RoleCheckboxGroup from '@/components/RoleCheckboxGroup'
import type { ProjectRole } from '@/lib/project-roles'

export default async function ProjectTeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: project, error: projectError }, { data: sessionProfile }] = await Promise.all([
    supabase.from('projects').select('id, name, project_code, is_active').eq('id', projectId).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ])
  if (projectError) throw new Error(`Failed to load project: ${projectError.message}`)
  if (!project) notFound()

  const isAdmin = sessionProfile?.role === 'admin'
  let canEdit = isAdmin
  if (!canEdit) {
    const { data: ownDcRow } = await supabase
      .schema('dcs')
      .from('project_roles')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .eq('role', 'dc')
      .limit(1)
    canEdit = (ownDcRow?.length ?? 0) > 0
  }

  const { data: teamRows, error: teamError } = await supabase
    .schema('dcs')
    .from('project_roles')
    .select('user_id, role')
    .eq('project_id', projectId)
  if (teamError) throw new Error(`Failed to load project team: ${teamError.message}`)

  const rolesByUser = new Map<string, ProjectRole[]>()
  for (const row of teamRows ?? []) {
    const existing = rolesByUser.get(row.user_id) ?? []
    existing.push(row.role)
    rolesByUser.set(row.user_id, existing)
  }
  const memberIds = [...rolesByUser.keys()]
  const hasDc = (teamRows ?? []).some((row) => row.role === 'dc')

  // Best effort: public.profiles RLS is "own row, or every row for a global
  // admin" (docs/02-data-model.md) — a non-admin DC/member reading this page
  // only gets their own name back here, not their teammates'. Falls back to
  // a short id so the table stays usable either way.
  const { data: memberProfiles } =
    memberIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', memberIds)
      : { data: [] as { id: string; full_name: string | null }[] }
  const nameById = new Map((memberProfiles ?? []).map((p) => [p.id, p.full_name]))
  const displayName = (id: string) => nameById.get(id) ?? `${id.slice(0, 8)}…`

  let candidates: { id: string; label: string }[] = []
  if (canEdit) {
    const { data: allProfiles } = await supabase.from('profiles').select('id, full_name').order('full_name')
    candidates = (allProfiles ?? [])
      .filter((p) => !rolesByUser.has(p.id))
      .map((p) => ({ id: p.id, label: p.full_name ?? `${p.id.slice(0, 8)}…` }))
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        {!project.is_active && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">inactive</span>
        )}
      </div>
      <p className="mb-6 text-sm text-gray-500">{project.project_code}</p>

      {!hasDc && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No Document Controller assigned to this project.
        </div>
      )}
      {!canEdit && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Read-only — only an admin or this project&apos;s Document Controller can change roles here.
        </div>
      )}

      <div className="space-y-3">
        {memberIds.length === 0 ? (
          <p className="text-sm text-gray-500">No team members visible.</p>
        ) : (
          memberIds.map((memberId) => (
            <div key={memberId} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 font-medium text-sm">{displayName(memberId)}</div>
              <RoleCheckboxGroup
                projectId={projectId}
                userId={memberId}
                initialRoles={rolesByUser.get(memberId) ?? []}
                disabled={!canEdit}
              />
            </div>
          ))
        )}
      </div>

      {canEdit && (
        <div className="mt-6">
          <AddMemberForm projectId={projectId} candidates={candidates} />
        </div>
      )}
    </div>
  )
}
