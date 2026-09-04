// DCS 1a.12: render gate for project-scoped actions (e.g. "show the Approve
// button only to this project's DC/CHK"). Async Server Component, no client
// fetching (CLAUDE.md convention) — the actual decision is the pure
// hasAnyRole() in lib/auth-helpers.ts, unit tested there; this component is
// a thin wrapper so it stays untested-but-trivial.
//
// This is rendering guidance only. RLS still decides what the database
// allows — never wire a mutation to "IfRole rendered it" as authorization.
import type { ReactNode } from 'react'
import { createClient } from '@scl/db/server'
import { getUserProjectRoles } from '@/app/data/actions/auth-helpers'
import { hasAnyRole, type ProjectRole } from '@/lib/auth-helpers'

type IfRoleProps = {
  projectId: string
  roles: readonly ProjectRole[]
  children: ReactNode
}

export async function IfRole({ projectId, roles, children }: IfRoleProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const rolesByProject = await getUserProjectRoles(user.id)
  const held = rolesByProject.get(projectId) ?? []
  if (!hasAnyRole(held, roles)) return null

  return <>{children}</>
}
