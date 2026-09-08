// DCS 1a.13: the signed-in user's own module grants, read via the self-read
// RLS policy on public.module_permissions ("Users read own module
// permissions", 1a.22). Not an authorization gate itself; ADR-0009 defers
// wiring this table into proxy.ts to a later task, and this task doesn't
// change that.
//
// Takes a typed client rather than constructing its own, like
// lib/auth-helpers.ts's fetchUserProjectRoles — keeps this callable from a
// server action, an RSC, or a Vitest test alike.
//
// Sole source of truth for "how many modules does this person have" on the
// DCS side — the one caller (app/(app)/layout.tsx) uses it to decide
// whether the module switcher renders at all, mirroring
// apps/timesheet/app/data/actions/module-permissions.ts's
// getMyModuleAccess(). Kept as a same-shape sibling rather than merged into
// one shared helper — these are two separate Next.js deployments and that
// merge is an explicitly deferred task (docs/deferred-tasks.md, section y).
//
// Prod is currently 7 migrations behind main and does not have this table
// at all (verified by reading prod, 2026-09-05). This function is called
// unguarded from app/(app)/layout.tsx, which wraps every DCS route — an
// earlier version threw here and reproducibly took down the entire shell
// (Next.js error boundary on every route, not just the header) the moment
// the table was absent, so this never throws on a read failure.
//
// `degraded: true` is NOT the same as "no extra modules" here. The one
// caller uses it to decide whether to show the switcher's TES entry — and
// must fail OPEN (assume TES access) on degraded, not closed: this is DCS's
// own sidebar, so failing closed here means "hide the switcher on this
// account's read hiccup" strands a genuine tes+dcs user inside DCS with no
// way back to TES for however long the read stays unreachable. A wrong
// TES link costs nothing (TES independently re-checks access), so this
// fails toward showing it.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Enums } from '@scl/db'

export type PortalModule = Enums<'portal_module'>

export async function fetchMyModuleAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ modules: PortalModule[]; degraded: boolean }> {
  const { data, error } = await supabase.from('module_permissions').select('module').eq('user_id', userId)
  if (error) {
    console.error('fetchMyModuleAccess: module_permissions read failed, degrading to no extra modules', error)
    return { modules: [], degraded: true }
  }
  return { modules: (data ?? []).map((row) => row.module), degraded: false }
}
