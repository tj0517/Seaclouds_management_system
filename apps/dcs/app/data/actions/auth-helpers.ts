'use server'

// DCS 1a.12: project-level role guard + reader for server actions. The
// mutation logic lives in lib/auth-helpers.ts (framework-agnostic, unit
// tested); this file binds it to the session client and to React's
// per-request cache(), following the split already used by
// app/data/actions/project-roles.ts.
import { cache } from 'react'
import { createClient } from '@scl/db/server'
import {
  checkProjectRole,
  loadUserProjectRoles,
  ProjectRoleAuthorizationError,
  type ProjectRole,
} from '@/lib/auth-helpers'

// cache() memoizes this zero-arg factory per request under Next.js, so every
// call during the same render/action chain shares one store. Outside a
// Next.js request (e.g. a script) cache() is a passthrough and this just
// returns a fresh Map each time, which is still correct — only unmemoized.
const getRequestRoleStore = cache(() => new Map<string, Promise<Map<string, ProjectRole[]>>>())

/** A user's dcs.project_roles, grouped by project. One query per request. */
export async function getUserProjectRoles(userId: string): Promise<Map<string, ProjectRole[]>> {
  const supabase = await createClient()
  return loadUserProjectRoles(getRequestRoleStore(), supabase, userId)
}

/**
 * Guard for server actions: throws ProjectRoleAuthorizationError when the
 * signed-in user does not hold one of `roles` on `projectId`. This is a
 * second line of defence in front of RLS (public.has_project_role /
 * is_doc_controller) — it never widens what the database allows, it only
 * turns a would-be empty RLS-filtered result into a readable error.
 */
export async function requireProjectRole(
  projectId: string,
  roles: readonly ProjectRole[],
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ProjectRoleAuthorizationError(projectId, roles)

  const rolesByProject = await getUserProjectRoles(user.id)
  checkProjectRole(rolesByProject, projectId, roles)
}

export { ProjectRoleAuthorizationError }
export type { ProjectRole }
