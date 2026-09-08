import type { SupabaseClient } from '@supabase/supabase-js'

// 1a.23: route-level enforcement for `public.module_permissions`. Until this
// task the table only drove tile *visibility* (ADR-0009 deferred wiring it
// into proxy.ts/admin/layout.tsx on purpose). apps/dcs/proxy.ts calls this
// once, for its one module ('dcs'), to decide whether the request gets in at
// all — unlike Timesheet, which has no equivalent gate: TES is this app's
// only reason to exist, so nothing there needs to ask "does this user have
// TES" from inside the TES app itself (see the comment on the portal tile,
// apps/timesheet/app/page.tsx, for why that tile stays unconditional too).
//
// Deliberately the OPPOSITE failure mode from the tile-visibility helpers
// (`app/data/actions/module-permissions.ts`, `lib/module-permissions.ts`),
// which fail closed (hide the tile) when the table is missing or errors —
// safe there, because the current module stays reachable either way. Here
// the table gates the only module DCS serves: failing closed on a missing
// table or a transient read error would turn an infra hiccup into a full
// outage for every user, which is worse than the enforcement gap that
// existed (by design) before this task. So: fail OPEN, and log it here,
// from this function's own path — not left to whatever the caller happens
// to do next. An earlier version of this file left the log out on purpose,
// reasoning that apps/dcs/proxy.ts's only caller today always falls through
// into apps/dcs/app/(app)/layout.tsx on the same request, which independently
// calls fetchMyModules() and logs the identical read failure — so skipping
// the log here avoided printing the same failure twice for one request.
// That reasoning doesn't survive review: it makes this function's contract
// ("degrade loudly") depend on a call site it doesn't control staying
// exactly as it is today. Rationale, expiry condition, and why "log twice"
// is the correct default rather than an anomaly to engineer around: see
// ADR-0011.
//
// Own leaf export (`@scl/db/module-access`), not the main `@scl/db` entry,
// for the same reason as `cookie-options.ts` — no `next/headers`, safe for
// Edge middleware.
export async function hasModuleAccess(
  supabase: SupabaseClient,
  userId: string,
  moduleName: 'tes' | 'dcs' | 'bms',
): Promise<boolean> {
  const { data, error } = await supabase
    .from('module_permissions')
    .select('module')
    .eq('user_id', userId)
    .eq('module', moduleName)
    .maybeSingle()

  if (error) {
    console.error(
      `hasModuleAccess: module_permissions read failed for module=${moduleName}, failing open`,
      error,
    )
    return true
  }

  return data !== null
}
