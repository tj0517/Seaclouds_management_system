'use client'

// DCS 1a.14: adds a first role for someone not yet on the project's team,
// from the "per project" view. Candidates come from
// public.dcs_profile_directory() (1a.14b) minus the current team — for an
// admin or any DC that's the whole directory; renders whatever candidate
// list it's given either way.
//
// DCS 1a.24: same pending/double-submit treatment as RoleCheckboxGroup, and
// the bare <select>/<button> are now themed like the rest of the app.
import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { setProjectRoles } from '@/app/data/actions/project-roles'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

type Candidate = { id: string; label: string }

type Props = {
  projectId: string
  candidates: Candidate[]
}

// DCS 1b.27: same editable/read-only convention as Input/Textarea — see
// components/ui/input.tsx. Native <select> has no read-only state.
export const SELECT_CLASS =
  'h-9 rounded-md border border-field-border bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:opacity-50'

export default function AddMemberForm({ projectId, candidates }: Props) {
  const { run, refresh, pending } = usePendingAction()
  const [userId, setUserId] = useState('')
  const [roles, setRoles] = useState<ProjectRole[]>([])
  const [error, setError] = useState<string | null>(null)

  const toggle = (role: ProjectRole) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleAdd = async () => {
    if (!userId || roles.length === 0) return
    setError(null)
    const result = await run(() => setProjectRoles({ projectId, userId, roles }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setUserId('')
    setRoles([])
    refresh()
  }

  if (candidates.length === 0) {
    return <p className="text-xs text-muted-foreground">No other profiles readable from this session to add.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-card p-4">
      <select
        aria-label="Add a member"
        className={SELECT_CLASS}
        value={userId}
        disabled={pending}
        onChange={(e) => setUserId(e.target.value)}
      >
        <option value="">Add a member…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {PROJECT_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring"
            checked={roles.includes(role)}
            disabled={pending}
            onChange={() => toggle(role)}
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
      <Button
        type="button"
        size="sm"
        onClick={handleAdd}
        disabled={!userId || roles.length === 0 || pending}
        className="ml-auto"
      >
        {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1.5 h-3.5 w-3.5" />}
        {pending ? 'Adding…' : 'Add'}
      </Button>
      {error && <span className="text-xs text-destructive">Error: {error}</span>}
    </div>
  )
}
