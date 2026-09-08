'use server'

// DCS 1a.06: grant / revoke a per-project DCS role. 1a.14 adds setProjectRoles
// (the whole-set save behind the role-matrix screen) and the revalidatePath()
// calls that screen needs. grantProjectRole/revokeProjectRole still have no
// UI caller — the screen saves through setProjectRoles only, diff-based, so
// they keep no revalidatePath() of their own. The logic lives in
// lib/project-roles.ts so it can be exercised outside Next.js; this file
// binds it to the session client.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  grantProjectRole as grantWith,
  revokeProjectRole as revokeWith,
  setProjectRoles as setWith,
  type ActionResult,
  type ProjectRole,
  type ProjectRoleInput,
  type ProjectRoleRow,
  type SetProjectRolesInput,
} from '@/lib/project-roles'

export async function grantProjectRole(
  input: ProjectRoleInput,
): Promise<ActionResult<ProjectRoleRow>> {
  const supabase = await createClient()
  return grantWith(supabase, input)
}

export async function revokeProjectRole(
  input: ProjectRoleInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  return revokeWith(supabase, input)
}

export async function setProjectRoles(
  input: SetProjectRolesInput,
): Promise<ActionResult<{ granted: ProjectRole[]; revoked: ProjectRole[] }>> {
  const supabase = await createClient()
  const result = await setWith(supabase, input)
  if (result.ok) {
    revalidatePath(`/admin/projects/${input.projectId}`)
    revalidatePath(`/admin/users/${input.userId}`)
  }
  return result
}
