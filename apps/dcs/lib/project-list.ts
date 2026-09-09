// DCS 1a.14b: the /dcs project list's own filter, app-side (ADR-0012's
// consequence, corrected by the 1a.14 review note (aa): NOT a new
// public.projects policy — that shared, load-bearing policy stays untouched,
// see the migration comment on public.dcs_profile_directory()). Reuses
// fetchUserProjectRoles (lib/auth-helpers.ts) rather than issuing its own
// query — "reuse, don't duplicate".
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'
import { fetchUserProjectRoles } from './auth-helpers'

type DbClient = SupabaseClient<Database>

export type ProjectListFilter =
  | { kind: 'all' }
  | { kind: 'ids'; ids: string[] }
  | { kind: 'degraded' }

/**
 * admin: no filter (public.projects' own policy already shows every project
 * to every signed-in user, admin included — nothing extra to do). Everyone
 * else: the set of project ids they hold ANY dcs.project_roles row on —
 * narrower than is_project_member (which also counts plain TES hour-logging
 * via project_assignments): this list is DCS's own, a DCS role is what
 * earns a project a place on it.
 *
 * Fails CLOSED on a read error (`{kind: 'degraded'}`) — the opposite of
 * lib/module-permissions.ts's fetchMyModuleAccess. See ADR-0013 for why
 * (the short version: fail-open there avoids a real TES lockout; fail-open
 * here would just silently defeat this function's own purpose).
 */
export async function resolveProjectListFilter(
  supabase: DbClient,
  userId: string,
  isAdmin: boolean,
): Promise<ProjectListFilter> {
  if (isAdmin) return { kind: 'all' }

  try {
    const rolesByProject = await fetchUserProjectRoles(supabase, userId)
    return { kind: 'ids', ids: [...rolesByProject.keys()] }
  } catch (error) {
    console.error('resolveProjectListFilter: fetchUserProjectRoles failed, degrading to no projects', error)
    return { kind: 'degraded' }
  }
}
