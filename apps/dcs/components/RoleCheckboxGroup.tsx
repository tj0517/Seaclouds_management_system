'use client'

// DCS 1a.14: the editable unit of the role matrix — one (project, user) pair,
// six role checkboxes, one Save. Used by both views over dcs.project_roles
// (app/(app)/admin/users/[userId] and app/(app)/admin/projects/[projectId]):
// they differ only in which of projectId/userId is fixed per row. Local
// state batches all six checkboxes into one setProjectRoles() call on Save,
// so the audit trail records one coherent change, not six.
//
// DCS 1a.24: the save now runs through usePendingAction — the button stays
// pending until the refreshed page is on screen, not just until the action
// returns, and a second click while one is in flight is refused
// synchronously (lib/single-flight.ts). Which roles exist, who may edit and
// what the action does are unchanged.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { setProjectRoles } from '@/app/data/actions/project-roles'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

type Props = {
  projectId: string
  userId: string
  initialRoles: ProjectRole[]
  disabled?: boolean
}

export default function RoleCheckboxGroup({ projectId, userId, initialRoles, disabled = false }: Props) {
  const { run, refresh, pending } = usePendingAction()
  const [saved, setSaved] = useState<ProjectRole[]>(initialRoles)
  const [roles, setRoles] = useState<ProjectRole[]>(initialRoles)
  const [error, setError] = useState<string | null>(null)

  const dirty = roles.length !== saved.length || roles.some((role) => !saved.includes(role))

  const toggle = (role: ProjectRole) => {
    setError(null)
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleSave = async () => {
    setError(null)
    const result = await run(() => setProjectRoles({ projectId, userId, roles }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setSaved(roles)
    // Cross-row effects (e.g. the "no DC" badge, or the other view's copy of
    // this same row) live in the server-rendered parent, not this row's own
    // state — refresh so they pick up the new dcs.project_roles rows.
    refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {PROJECT_ROLES.map((role) => (
        <label
          key={role}
          className={`flex items-center gap-1.5 text-sm ${disabled ? 'text-muted-foreground' : ''}`}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input text-primary accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring"
            checked={roles.includes(role)}
            disabled={disabled || pending}
            onChange={() => toggle(role)}
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
      {!disabled && (
        <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || pending} className="ml-auto">
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">Error: {error}</span>}
    </div>
  )
}
