// DCS 1a.13: the signed-in user's own module grants, read via the self-read
// RLS policy on public.module_permissions ("Users read own module
// permissions", 1a.22). Used by the module switcher to decide which
// entries to show — not an authorization gate itself; ADR-0009 defers
// wiring this table into proxy.ts to a later task, and this task doesn't
// change that.
//
// Takes a typed client rather than constructing its own, like
// lib/auth-helpers.ts's fetchUserProjectRoles — keeps this callable from a
// server action, an RSC, or a Vitest test alike.
//
// Prod is currently 7 migrations behind main and does not have this table
// at all (verified by reading prod, 2026-09-05). This function is called
// unguarded from app/(app)/layout.tsx, which wraps every DCS route — an
// earlier version threw here and reproducibly took down the entire shell
// (Next.js error boundary on every route, not just the header) the moment
// the table was absent. Fail closed instead — log once, treat as "no extra
// modules" so only the current module (hardcoded in ModuleSwitcher) renders.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Enums } from '@scl/db'

export type PortalModule = Enums<'portal_module'>

export async function fetchMyModules(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PortalModule[]> {
  const { data, error } = await supabase.from('module_permissions').select('module').eq('user_id', userId)
  if (error) {
    console.error('fetchMyModules: module_permissions read failed, degrading to no extra modules', error)
    return []
  }
  return (data ?? []).map((row) => row.module)
}
