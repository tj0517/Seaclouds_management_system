'use server'

import { createClient } from '@scl/db/server'
import { revalidatePath } from 'next/cache'
import { getUserRoleAndProjects } from './auth-helpers'

type PortalModule = 'tes' | 'dcs' | 'bms'

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
