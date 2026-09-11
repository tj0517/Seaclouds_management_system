// DCS 1a.14: user × project × DCS-role matrix, "per project" view — a team
// table, one row per member, one column group per role. Editable by admin or
// the project's own DC (requireAdminOrDc in lib/project-roles.ts mirrors
// this exactly — RLS is still the last line of defence, see setProjectRoles);
// read-only for every other project member. A non-member sees an empty team
// (dcs.project_roles RLS: "Project members read project roles").
//
// DCS 1a.14b: names (team table) and candidates (picker) now come from
// public.dcs_profile_directory() (lib/profile-directory.ts) instead of
// reading public.profiles directly — that policy is own-row-or-admin, which
// starved both for a non-admin DC. See the migration comment for why this
// is a function and not a wider profiles policy (column exposure).
//
// DCS 1a.17: this page also became the project's MDR summary and the home of
// EditProjectDialog — the wizard sends you here after creating a project, and
// this is where its settings are changed afterwards. The summary renders for
// every reader (mdr_settings' SELECT policy admits any signed-in user); the
// Edit button only for an admin, matching updateProjectMdr's requireAdmin and
// the "Admins manage mdr settings" / "Admin zarządza projektami" policies.
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import AddMemberForm from '@/components/AddMemberForm'
import EditProjectDialog from '@/components/EditProjectDialog'
import RoleCheckboxGroup from '@/components/RoleCheckboxGroup'
import { Button } from '@/components/ui/button'
import { getActiveClients } from '@/lib/clients-admin'
import { excludeIds, getProfileDirectory } from '@/lib/profile-directory'
import { MDR_STATUS_LABELS, PROCESS_TYPE_LABELS, getProjectMdr } from '@/lib/project-mdr'
import type { ProjectRole } from '@/lib/project-roles'

export default async function ProjectTeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [mdr, { data: sessionProfile }, directory] = await Promise.all([
    getProjectMdr(supabase, projectId),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    getProfileDirectory(supabase),
  ])
  if (!mdr) notFound()
  const { project, settings } = mdr

  const isAdmin = sessionProfile?.role === 'admin'

  // Only the Edit dialog needs the client list, and only an admin sees it —
  // so this read is skipped entirely otherwise rather than being fetched and
  // thrown away (clients' SELECT policy would also return a narrower set).
  const clients = isAdmin ? await getActiveClients(supabase) : []
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

  const nameById = new Map(directory.entries.map((entry) => [entry.id, entry.full_name]))
  const displayName = (id: string) => nameById.get(id) ?? `${id.slice(0, 8)}…`

  let candidates: { id: string; label: string }[] = []
  if (canEdit) {
    candidates = excludeIds(directory.entries, rolesByUser.keys())
      .map((entry) => ({ id: entry.id, label: entry.full_name ?? `${entry.id.slice(0, 8)}…` }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        {!project.is_active && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">inactive</span>
        )}
        {isAdmin && (
          <div className="ml-auto">
            <EditProjectDialog
              project={project}
              settings={settings}
              clients={clients.map((client) => ({ id: client.id, name: client.name, code: client.code }))}
              trigger={
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              }
            />
          </div>
        )}
      </div>
      <p className="mb-6 text-sm text-gray-500">{project.project_code}</p>

      {settings ? (
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">Process type</dt>
            <dd>{project.process_type ? PROCESS_TYPE_LABELS[project.process_type] : 'not classified'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Year</dt>
            <dd>{project.year ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Review cycle</dt>
            <dd>
              {settings.cycle_idc_to_ifr}/{settings.cycle_ifr_to_retcom}/{settings.cycle_retcom_to_ifc} days
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">MDR status</dt>
            <dd>{MDR_STATUS_LABELS[settings.status]}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Budget</dt>
            <dd>{settings.budget_hours === null ? 'no budget' : `${settings.budget_hours} h`}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">CPY numbering</dt>
            <dd>{settings.cpy_numbering ? 'yes' : 'no'}</dd>
          </div>
        </dl>
      ) : (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          DCS does not run this project — it has no MDR settings row (docs/02-data-model.md).
        </div>
      )}

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
      {directory.degraded && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&apos;t load teammate names right now — showing ids instead where a name is missing.
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
