'use client'

// DCS 1a.14: the editable unit of the role matrix — one (project, user) pair,
// six role checkboxes, one Save. Used by both views over dcs.project_roles
// (app/(app)/admin/users/[userId] and app/(app)/admin/projects/[projectId]):
// they differ only in which of projectId/userId is fixed per row. Local
// state batches all six checkboxes into one setProjectRoles() call on Save,
// so the audit trail records one coherent change, not six.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setProjectRoles } from '@/app/data/actions/project-roles'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

type Props = {
  projectId: string
  userId: string
  initialRoles: ProjectRole[]
  disabled?: boolean
}

export default function RoleCheckboxGroup({ projectId, userId, initialRoles, disabled = false }: Props) {
  const router = useRouter()
  const [saved, setSaved] = useState<ProjectRole[]>(initialRoles)
  const [pending, setPending] = useState<ProjectRole[]>(initialRoles)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = pending.length !== saved.length || pending.some((role) => !saved.includes(role))

  const toggle = (role: ProjectRole) => {
    setError(null)
    setPending((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const result = await setProjectRoles({ projectId, userId, roles: pending })
    setSaving(false)
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setSaved(pending)
    // Cross-row effects (e.g. the "no DC" badge, or the other view's copy of
    // this same row) live in the server-rendered parent, not this row's own
    // state — refresh so they pick up the new dcs.project_roles rows.
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {PROJECT_ROLES.map((role) => (
        <label
          key={role}
          className={`flex items-center gap-1.5 text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
            checked={pending.includes(role)}
            disabled={disabled || saving}
            onChange={() => toggle(role)}
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="ml-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      {error && <span className="text-xs text-red-600">Error: {error}</span>}
    </div>
  )
}
