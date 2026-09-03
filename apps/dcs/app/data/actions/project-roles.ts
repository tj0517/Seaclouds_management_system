'use server'

// DCS 1a.06: grant / revoke a per-project DCS role. No screen yet — the
// user × project × role matrix is task 1a.14; until then these are called
// from server code only. The logic lives in lib/project-roles.ts so it can be
// exercised outside Next.js; this file binds it to the session client.
//
// No revalidatePath() here on purpose: no page renders project roles yet.
// 1a.14 adds the paths together with the screen.
import { createClient } from '@scl/db/server'
import {
  grantProjectRole as grantWith,
  revokeProjectRole as revokeWith,
  type ActionResult,
  type ProjectRoleInput,
  type ProjectRoleRow,
} from '@/lib/project-roles'

export async function grantProjectRole(
  input: ProjectRoleInput,
): Promise<ActionResult<ProjectRoleRow>> {
  const supabase = await createClient()
  return grantWith(supabase, input)
}

export async function revokeProjectRole(
  input: ProjectRoleInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  return revokeWith(supabase, input)
}
