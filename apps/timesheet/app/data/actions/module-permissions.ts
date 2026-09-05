'use server'

import { createClient } from '@scl/db/server'
import { revalidatePath } from 'next/cache'
import type { Enums } from '@scl/db'
import { getUserRoleAndProjects } from './auth-helpers'

export type PortalModule = Enums<'portal_module'>

// DCS 1a.13: the signed-in user's own module grants — this is what the
// self-read RLS policy ("Users read own module permissions") is for. Used
// by the module switcher to decide which entries to show; not an
// authorization gate itself (see ADR-0009 consequences — proxy.ts/admin
// layout don't consume this table yet, and this task doesn't change that).
//
// Prod is currently 7 migrations behind main and does not have this table
// at all (verified by reading prod, 2026-09-05) — reproduced locally
// (table dropped, same PostgREST PGRST205 "not in schema cache" the prod
// gap would produce): a missing/unreachable table must never take down the
// header. Fail closed — log once, treat as "no extra modules" so only the
// current module (hardcoded in ModuleSwitcher) renders.
export async function getMyModulePermissions(): Promise<PortalModule[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase.from('module_permissions').select('module').eq('user_id', user.id)
  if (error) {
    console.error('getMyModulePermissions: module_permissions read failed, degrading to no extra modules', error)
    return []
  }
  return (data ?? []).map((row) => row.module)
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
