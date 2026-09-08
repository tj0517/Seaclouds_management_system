// Core of the project-role mutations (DCS 1a.06, widened in 1a.14),
// independent of Next.js: takes any typed Supabase client, so the same code
// runs from a server action (session client, RLS applies) and from a
// verification script. The `'use server'` wrappers live in
// app/data/actions/project-roles.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { Constants } from '@scl/db'
import type { Database, Enums, Tables } from '@scl/db'
import { fetchUserProjectRoles, hasAnyRole } from './auth-helpers'

export type ProjectRole = Enums<{ schema: 'dcs' }, 'project_role'>
export type ProjectRoleRow = Tables<{ schema: 'dcs' }, 'project_roles'>

/** Allowed values straight from the generated enum — never a hand-typed list. */
export const PROJECT_ROLES: readonly ProjectRole[] = Constants.dcs.Enums.project_role

/** Display labels, glossary terms (docs/00-glossary.md) — not the DB codes. */
export const ROLE_LABELS: Record<ProjectRole, string> = {
  orig: 'Originator',
  rev: 'Reviewer',
  chk: 'Checker',
  app: 'Approver',
  dc: 'Document Controller',
  view: 'Viewer',
}

export type ProjectRoleInput = {
  projectId: string
  userId: string
  role: ProjectRole
}

export type SetProjectRolesInput = {
  projectId: string
  userId: string
  roles: ProjectRole[]
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

/** Same shape as parseProjectRoleInput, but for a whole role SET on one (project, user) pair. */
export function parseSetProjectRolesInput(input: unknown): SetProjectRolesInput | null {
  if (typeof input !== 'object' || input === null) return null
  const { projectId, userId, roles } = input as Record<string, unknown>
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return null
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return null
  if (!Array.isArray(roles)) return null
  const deduped = new Set<ProjectRole>()
  for (const role of roles) {
    if (!isProjectRole(role)) return null
    deduped.add(role)
  }
  return { projectId, userId, roles: [...deduped] }
}

/**
 * Server-side admin-or-DC guard (widened in 1a.14 — see deferred-tasks.md q).
 * RLS already rejects a write that fails this ("Admins manage project roles"
 * / "Doc controllers manage project roles"), but the action must refuse on
 * its own too (CLAUDE.md: guard in the action, not only in the database) and
 * must not leak a half-informative RLS error.
 *
 * Deliberately not requireProjectRole() from lib/auth-helpers.ts: that
 * helper has no admin bypass (a global admin holds no dcs.project_roles row)
 * and throws rather than returning an ActionResult, which would break the
 * error-mapping contract every caller in this file relies on. It reuses that
 * helper's two exported primitives (fetchUserProjectRoles, hasAnyRole)
 * instead of re-querying dcs.project_roles by hand.
 */
async function requireAdminOrDc(supabase: DbClient, projectId: string): Promise<ActionResult<string>> {
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
  if (profile.role === 'admin') return { ok: true, data: user.id }

  const rolesByProject = await fetchUserProjectRoles(supabase, user.id)
  const held = rolesByProject.get(projectId) ?? []
  if (!hasAnyRole(held, ['dc'])) return { ok: false, error: 'forbidden' }

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

  const auth = await requireAdminOrDc(supabase, input.projectId)
  if (!auth.ok) return auth

  const { data, error } = await supabase
    .schema('dcs')
    .from('project_roles')
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      role: input.role,
      assigned_by: auth.data,
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

  const auth = await requireAdminOrDc(supabase, input.projectId)
  if (!auth.ok) return auth

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

/**
 * Sets the full DCS role set for one (project, user) pair in one call:
 * computes the diff against the current rows and issues only the INSERTs
 * and DELETEs needed to reach `roles` — never delete-all-then-reinsert, so
 * public.audit_log (via the audit_project_roles trigger) records real
 * changes only, and a no-op save (same set passed again) writes nothing.
 * Authorised for admin or the project's DC, same guard as grant/revoke.
 */
export async function setProjectRoles(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<{ granted: ProjectRole[]; revoked: ProjectRole[] }>> {
  const input = parseSetProjectRolesInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const auth = await requireAdminOrDc(supabase, input.projectId)
  if (!auth.ok) return auth

  const { data: currentRows, error: readError } = await supabase
    .schema('dcs')
    .from('project_roles')
    .select('id, role')
    .eq('project_id', input.projectId)
    .eq('user_id', input.userId)
  if (readError) return { ok: false, error: 'db_error', message: readError.message }

  const currentRoles = new Set((currentRows ?? []).map((row) => row.role))
  const nextRoles = new Set(input.roles)

  const toGrant = input.roles.filter((role) => !currentRoles.has(role))
  const toRevoke = (currentRows ?? []).filter((row) => !nextRoles.has(row.role))

  if (toGrant.length > 0) {
    const { error: insertError } = await supabase
      .schema('dcs')
      .from('project_roles')
      .insert(
        toGrant.map((role) => ({
          project_id: input.projectId,
          user_id: input.userId,
          role,
          assigned_by: auth.data,
        })),
      )
    if (insertError) return mapDbError(insertError.code, insertError.message)
  }

  if (toRevoke.length > 0) {
    const { error: deleteError } = await supabase
      .schema('dcs')
      .from('project_roles')
      .delete()
      .in(
        'id',
        toRevoke.map((row) => row.id),
      )
    if (deleteError) return mapDbError(deleteError.code, deleteError.message)
  }

  return { ok: true, data: { granted: toGrant, revoked: toRevoke.map((row) => row.role) } }
}
