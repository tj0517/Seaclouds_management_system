// DCS 1a.12: project-level role awareness on top of dcs.project_roles
// (1a.06/1a.09). RLS is the enforcement layer (public.has_project_role and
// friends, see 20260903184934_add_project_role_functions_and_policies.sql);
// everything here only improves error messages and rendering. Passing
// requireProjectRole never implies the database will allow the write.
//
// Split for testability, like lib/project-roles.ts: this file takes any
// typed Supabase client and has no Next.js/React import beyond types, so it
// runs from a server action, an RSC, or a Vitest test alike. The 'use server'
// wrapper (including the React `cache()` per-request wiring) lives in
// app/data/actions/auth-helpers.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Enums } from '@scl/db'

export type ProjectRole = Enums<{ schema: 'dcs' }, 'project_role'>

type DbClient = SupabaseClient<Database>

export class ProjectRoleAuthorizationError extends Error {
  readonly projectId: string
  readonly requiredRoles: readonly ProjectRole[]

  constructor(projectId: string, requiredRoles: readonly ProjectRole[]) {
    super(
      `Missing required project role on project ${projectId}: needs one of [${requiredRoles.join(', ')}]`,
    )
    this.name = 'ProjectRoleAuthorizationError'
    this.projectId = projectId
    this.requiredRoles = requiredRoles
  }
}

/** One query: every dcs.project_roles row for this user, grouped by project. */
export async function fetchUserProjectRoles(
  supabase: DbClient,
  userId: string,
): Promise<Map<string, ProjectRole[]>> {
  const { data, error } = await supabase
    .schema('dcs')
    .from('project_roles')
    .select('project_id, role')
    .eq('user_id', userId)

  if (error) throw new Error(`fetchUserProjectRoles: ${error.message}`)

  const byProject = new Map<string, ProjectRole[]>()
  for (const row of data) {
    const roles = byProject.get(row.project_id) ?? []
    roles.push(row.role)
    byProject.set(row.project_id, roles)
  }
  return byProject
}

/**
 * Dedupes repeated fetches for the same userId against one shared store.
 * The store is request-scoped by the caller — see the `cache()`-backed
 * factory in app/data/actions/auth-helpers.ts, which supplies a fresh Map
 * per request under Next.js. This function has no opinion about request
 * lifetimes on purpose: React's `cache()` is a no-op outside a Next.js
 * render (verified against node_modules/react/cjs/react.production.js), so
 * keeping the dedup logic here — operating on a Map the caller owns — is
 * what makes it testable without a Next.js runtime.
 */
export function loadUserProjectRoles(
  store: Map<string, Promise<Map<string, ProjectRole[]>>>,
  supabase: DbClient,
  userId: string,
): Promise<Map<string, ProjectRole[]>> {
  const existing = store.get(userId)
  if (existing) return existing
  const promise = fetchUserProjectRoles(supabase, userId)
  store.set(userId, promise)
  return promise
}

/** Pure decision behind requireProjectRole and <IfRole>. */
export function hasAnyRole(
  rolesHeld: readonly ProjectRole[],
  rolesRequired: readonly ProjectRole[],
): boolean {
  return rolesHeld.some((role) => rolesRequired.includes(role))
}

export function checkProjectRole(
  rolesByProject: Map<string, ProjectRole[]>,
  projectId: string,
  requiredRoles: readonly ProjectRole[],
): void {
  const held = rolesByProject.get(projectId) ?? []
  if (!hasAnyRole(held, requiredRoles)) {
    throw new ProjectRoleAuthorizationError(projectId, requiredRoles)
  }
}
