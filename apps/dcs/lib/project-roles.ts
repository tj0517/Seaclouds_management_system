// Core of the project-role mutations (DCS 1a.06), independent of Next.js:
// takes any typed Supabase client, so the same code runs from a server action
// (session client, RLS applies) and from a verification script. The
// `'use server'` wrappers live in app/data/actions/project-roles.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { Constants } from '@scl/db'
import type { Database, Enums, Tables } from '@scl/db'

export type ProjectRole = Enums<{ schema: 'dcs' }, 'project_role'>
export type ProjectRoleRow = Tables<{ schema: 'dcs' }, 'project_roles'>

/** Allowed values straight from the generated enum — never a hand-typed list. */
export const PROJECT_ROLES: readonly ProjectRole[] = Constants.dcs.Enums.project_role

export type ProjectRoleInput = {
  projectId: string
  userId: string
  role: ProjectRole
}

export type ProjectRoleError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'role_already_granted'
  | 'unknown_project_or_user'
  | 'role_not_found'
  | 'db_error'

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProjectRoleError; message?: string }

type DbClient = SupabaseClient<Database>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLES as readonly string[]).includes(value)
}

/** Validates untrusted input (server actions receive whatever the caller sends). */
export function parseProjectRoleInput(input: unknown): ProjectRoleInput | null {
  if (typeof input !== 'object' || input === null) return null
  const { projectId, userId, role } = input as Record<string, unknown>
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return null
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return null
  if (!isProjectRole(role)) return null
  return { projectId, userId, role }
}

/**
 * Server-side admin guard. RLS already rejects non-admin writes, but the
 * action must refuse on its own too (CLAUDE.md: guard in the action, not only
 * in the database) and must not leak a half-informative RLS error.
 */
async function requireAdmin(supabase: DbClient): Promise<ActionResult<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated' }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (error || !profile) return { ok: false, error: 'forbidden' }
  if (profile.role !== 'admin') return { ok: false, error: 'forbidden' }

  return { ok: true, data: user.id }
}

function mapDbError(code: string | undefined, message: string): ActionResult<never> {
  switch (code) {
    case '23505':
      return { ok: false, error: 'role_already_granted' }
    case '23503':
      return { ok: false, error: 'unknown_project_or_user' }
    case '42501':
      return { ok: false, error: 'forbidden' }
    default:
      return { ok: false, error: 'db_error', message }
  }
}

export async function grantProjectRole(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<ProjectRoleRow>> {
  const input = parseProjectRoleInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const admin = await requireAdmin(supabase)
  if (!admin.ok) return admin

  const { data, error } = await supabase
    .schema('dcs')
    .from('project_roles')
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      role: input.role,
      assigned_by: admin.data,
    })
    .select()
    .single()

  if (error) return mapDbError(error.code, error.message)
  return { ok: true, data }
}

export async function revokeProjectRole(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
  const input = parseProjectRoleInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const admin = await requireAdmin(supabase)
  if (!admin.ok) return admin

  const { data, error } = await supabase
    .schema('dcs')
    .from('project_roles')
    .delete()
    .eq('project_id', input.projectId)
    .eq('user_id', input.userId)
    .eq('role', input.role)
    .select('id')

  if (error) return mapDbError(error.code, error.message)
  if (data.length === 0) return { ok: false, error: 'role_not_found' }
  return { ok: true, data: { id: data[0].id } }
}
