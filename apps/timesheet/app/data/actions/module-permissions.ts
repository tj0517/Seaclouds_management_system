'use server'

import { createClient } from '@scl/db/server'
import { revalidatePath } from 'next/cache'
import type { Enums } from '@scl/db'
import { getUserRoleAndProjects } from './auth-helpers'

export type PortalModule = Enums<'portal_module'>

// DCS 1a.13: the signed-in user's own module grants — this is what the
// self-read RLS policy ("Users read own module permissions") is for. Not
// an authorization gate itself (see ADR-0009 consequences — proxy.ts/admin
// layout don't consume this table yet, and this task doesn't change that).
//
// Sole source of truth for "how many modules does this person have" on the
// TES side — used by the portal redirect (app/page.tsx) AND every module
// switcher mount (app/tes/page.tsx, app/expenses/page.tsx,
// app/admin/layout.tsx). Previously two near-identical functions existed
// here (a plain fail-closed-to-[] one for the switcher, this degraded-aware
// one for the redirect); the plain one is gone so there's exactly one tally
// callers can disagree about how to read.
//
// Prod is currently 7 migrations behind main and does not have this table
// at all (verified by reading prod, 2026-09-05) — reproduced locally
// (table dropped, same PostgREST PGRST205 "not in schema cache" the prod
// gap would produce): a missing/unreachable table must never take down the
// header. `degraded: true` lets each caller decide fail-open vs fail-closed
// for its own situation instead of collapsing both "read failed" and
// "really has one module" into the same `[]` — those need different
// answers (redirect: never auto-collapse to one, stay on the portal;
// switcher: see the fail-open note below).
//
// Module-switcher callers treat `degraded` as "assume 2+ modules, not 1" —
// i.e. fail OPEN, same direction as the redirect, but for a different
// reason: hiding the switcher on a degraded read stripped a genuinely
// two-module user of their only way back to the other module while
// *inside* it (worst on DCS's own sidebar — see apps/dcs/lib/module-
// permissions.ts). Showing an extra cross-module link that turns out to be
// wrong costs nothing, since the destination re-checks access itself
// (DCS's own proxy gate, ADR-0011) — so callers here fail open rather than
// silently deciding "one module" for someone the read simply couldn't
// confirm.
export async function getMyModuleAccess(): Promise<{ modules: PortalModule[]; degraded: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { modules: [], degraded: false }

  const { data, error } = await supabase.from('module_permissions').select('module').eq('user_id', user.id)
  if (error) {
    console.error('getMyModuleAccess: module_permissions read failed, degrading to no extra modules', error)
    return { modules: [], degraded: true }
  }
  return { modules: (data ?? []).map((row) => row.module), degraded: false }
}

// DCS 1a.22: per-user module access (TES/DCS/BMS). Read-your-own is open to
// everyone via RLS; this helper is for the admin screen, which needs one
// user's full grant set regardless of who is asking (guarded below, not by
// the self-read policy).
export async function getModulePermissions(userId: string): Promise<PortalModule[]> {
  const roleInfo = await getUserRoleAndProjects()
  if (!roleInfo || roleInfo.role !== 'admin') return []

  const supabase = await createClient()
  const { data } = await supabase
    .from('module_permissions')
    .select('module')
    .eq('user_id', userId)

  return (data ?? []).map((row) => row.module)
}

export async function toggleModuleAccess(userId: string, module: PortalModule, granted: boolean) {
  const roleInfo = await getUserRoleAndProjects()
  if (!roleInfo || roleInfo.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = await createClient()

  if (granted) {
    const { error } = await supabase
      .from('module_permissions')
      .insert([{ user_id: userId, module }])
    if (error && error.code !== '23505') return { error: error.message }
  } else {
    const { error } = await supabase
      .from('module_permissions')
      .delete()
      .match({ user_id: userId, module })
    if (error) return { error: error.message }
  }

  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}
