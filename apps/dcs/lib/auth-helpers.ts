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

/**
 * DCS 1a.21a. Pure decision behind the `/admin/dictionaries` and
 * `/admin/clients` page guards and the matching `DcsSidebar` links.
 *
 * This is the *read* side of those two screens, and it is deliberately not
 * the same set as their write guards: dictionaries are editable by admin or
 * any DC (the same set as this), clients by an admin alone (a narrower one,
 * so a DC still lands on the read-only clients table). Neither write guard
 * — `requireAdminOrAnyDc` (lib/dictionaries-admin.ts) nor `requireAdmin`
 * (lib/clients-admin.ts) — is widened or narrowed by this function.
 *
 * Composed from `hasAnyRole` rather than issuing its own query, the same way
 * `requireAdminOrDc` (lib/project-roles.ts) composes the primitives in this
 * file: the single source of truth for "does this session hold role X on
 * project Y" stays `fetchUserProjectRoles`.
 */
export function isAdminOrAnyDc(
  isAdmin: boolean,
  rolesByProject: Map<string, ProjectRole[]>,
): boolean {
  if (isAdmin) return true
  for (const roles of rolesByProject.values()) {
    if (hasAnyRole(roles, ['dc'])) return true
  }
  return false
}

/**
 * DCS 1a.21a. Pure decision behind the per-row "Team" link on the project
 * list — who may *edit* that project's team, mirroring `requireAdminOrDc`
 * (lib/project-roles.ts) and the `canEdit` branch on
 * `app/(app)/admin/projects/[projectId]`.
 *
 * Rendering guidance only, like `<IfRole>`: the team page itself stays
 * readable by every project member (dcs.project_roles' "Project members read
 * project roles") and unguarded, and RLS still decides every write. Hiding
 * the link only keeps a reader from being offered an editor's entry point.
 */
export function isAdminOrProjectDc(
  isAdmin: boolean,
  rolesByProject: Map<string, ProjectRole[]>,
  projectId: string,
): boolean {
  return isAdmin || hasAnyRole(rolesByProject.get(projectId) ?? [], ['dc'])
}

/**
 * DCS 1a.21a. The degrade-safe read behind both `/admin` page guards
 * (`/admin/dictionaries`, `/admin/clients`) and the matching `DcsSidebar`
 * links: "is this session an admin, or the DC of any project?".
 *
 * Skips the query entirely for an admin — `profiles.role` already settles it,
 * and an admin must never be refused because of a dcs.project_roles hiccup.
 *
 * Degrades CLOSED, like resolveProjectListFilter (lib/project-list.ts) and
 * unlike fetchMyModuleAccess (lib/module-permissions.ts): a DC who cannot be
 * recognised as one is treated as a plain member for this render. That
 * direction is deliberate — these two screens are read-only for a DC anyway,
 * every write behind them is re-checked by its own guard and by RLS, and the
 * alternative (fail open) would hand the screens to whoever can make the
 * read fail. It also keeps the layout from throwing: this wraps every DCS
 * route, and an unguarded throw there takes down the whole shell rather than
 * one nav item (the exact failure lib/module-permissions.ts records hitting).
 */
export async function canOpenAdminScreens(
  supabase: DbClient,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true
  try {
    return isAdminOrAnyDc(false, await fetchUserProjectRoles(supabase, userId))
  } catch (error) {
    console.error('canOpenAdminScreens: project-roles read failed, refusing admin screens', error)
    return false
  }
}
