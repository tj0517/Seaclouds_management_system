'use client'

// DCS 1b.18: people × roles matrix for the project page — one row per team
// member, one column per DCS role. Clicking a cell grants or revokes that
// single role immediately through the EXISTING setProjectRoles() diff (no
// new write path): each click sends the member's current role set with just
// that one role added or removed, so the diff the action computes is always
// exactly one INSERT or one DELETE and public.audit_log gets exactly one row
// per click — the per-row batching RoleCheckboxGroup did is gone on this
// page by design (task's accepted consequence).
//
// Deliberately NOT a reuse of RoleCheckboxGroup (per-row batched Save,
// shared with /admin/users/[userId]) — see docs/tasks/DCS-1b.18.md,
// "Notatki z realizacji" (tj, 2026-09-25): keeping the per-user page's
// batched-Save UX untouched was chosen over unifying the two screens, so
// that page and its component are untouched by this task.
//
// Pending state is scoped per ROW: one usePendingAction() per person, same
// single-flight guarantee RoleCheckboxGroup relies on (a second click on
// the same row while one is in flight is refused). The row also remembers
// which column was last clicked, so only that cell shows the spinner while
// every cell in the row is disabled until the refreshed table is in the DOM
// (docs/03-conventions.md, the "pending until refreshed data is in the DOM"
// rule from 1b.09) — `pending` from the hook, not a locally-cleared flag,
// is what drives this, the same pattern RoleCheckboxGroup and AddMemberForm
// already use.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { setProjectRoles } from '@/app/data/actions/project-roles'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

export type RoleMatrixRow = {
  userId: string
  name: string
  roles: ProjectRole[]
}

type Props = {
  projectId: string
  rows: RoleMatrixRow[]
  /** Read-only for anyone who is neither admin nor this project's DC. */
  disabled?: boolean
}

export default function RoleMatrix({ projectId, rows, disabled = false }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          {PROJECT_ROLES.map((role) => (
            <TableHead key={role} className="text-center">
              {ROLE_LABELS[role]}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <RoleMatrixRowView key={row.userId} projectId={projectId} row={row} disabled={disabled} />
        ))}
      </TableBody>
    </Table>
  )
}

function RoleMatrixRowView({
  projectId,
  row,
  disabled,
}: {
  projectId: string
  row: RoleMatrixRow
  disabled: boolean
}) {
  const { run, refresh, pending } = usePendingAction()
  const [roles, setRoles] = useState<ProjectRole[]>(row.roles)
  const [pendingRole, setPendingRole] = useState<ProjectRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (role: ProjectRole) => {
    setError(null)
    setPendingRole(role)
    const nextRoles = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]
    const result = await run(() => setProjectRoles({ projectId, userId: row.userId, roles: nextRoles }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setRoles(nextRoles)
    // Cross-row effects (the "no DC" banner, the per-user page's copy of
    // this same row) live in the server-rendered parent — refresh so they
    // pick up the new dcs.project_roles rows.
    refresh()
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-medium">
        {row.name}
        {error && <div className="mt-1 text-xs font-normal text-destructive">Error: {error}</div>}
      </TableCell>
      {PROJECT_ROLES.map((role) => {
        const checked = roles.includes(role)
        const showSpinner = pending && pendingRole === role
        return (
          <TableCell key={role} className="text-center">
            <span className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                aria-label={`${ROLE_LABELS[role]} — ${row.name}`}
                checked={checked}
                disabled={disabled || pending}
                onChange={() => toggle(role)}
                className="h-4 w-4 rounded border-input text-primary accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
              />
              {showSpinner && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
              )}
            </span>
          </TableCell>
        )
      })}
    </TableRow>
  )
}
