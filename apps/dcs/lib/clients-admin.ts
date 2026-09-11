// DCS 1a.16: write side of public.clients — the clients admin screen.
// Independent of Next.js (same split as lib/project-roles.ts and
// lib/dictionaries-admin.ts): takes any typed Supabase client, so this runs
// from a server action (session client, RLS applies) and from a verification
// script. The 'use server' wrappers live in app/data/actions/clients.ts.
//
// RLS already enforces admin-only writes ("Admins manage clients", migration
// 20260901123548, unchanged by this task — docs/02-data-model.md's public.clients
// section) — this guard is the app's own line of defence in front of that
// (CLAUDE.md: RLS is the second line, the app guard is the first — both must
// deny). Deliberately plain admin-only, NOT admin-or-any-DC like
// requireAdminOrAnyDc in lib/dictionaries-admin.ts: docs/02-data-model.md
// records this as a conscious 1a.09 decision (a client can span several
// projects while DC is per-project, so "which DC may edit" is undefined
// until Phase 4), reaffirmed for this task in the brief.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesUpdate } from '@scl/db'

export type ClientRow = Tables<'clients'>

export type ClientError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'duplicate_code'
  | 'not_found'
  | 'db_error'

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ClientError; message?: string }

export type CreateClientInput = {
  name: string
  code: string
  contactEmail?: string | null
  notes?: string | null
}

// Deliberately has no `code` field — the update server action must not be
// able to accept one, even from an untrusted raw payload (code is immutable
// once created: it is a segment of CPY document numbers, docs/02-data-model.md).
// Enforced twice: at the type level here, and at runtime in
// parseUpdateClientInput, which only destructures the fields below and
// ignores anything else in the raw input.
//
// Every field besides `id` is optional and `undefined` means "leave
// unchanged" (as opposed to `null`, which means "clear") — updateClient below
// diffs against the current row and writes only what actually changed, the
// same fix docs/deferred-tasks.md (bb) flagged as missing from
// updateDictionaryEntry (an omitted optional field must never be silently
// nulled out).
export type UpdateClientInput = {
  id: string
  name?: string
  contactEmail?: string | null
  notes?: string | null
}

export type SetClientActiveInput = {
  id: string
  isActive: boolean
}

type DbClient = SupabaseClient<Database>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mirrors the DB CHECK constraint clients_code_format (migration
// 20260901123548): uppercase A-Z/0-9 only, 2-10 chars, no separators — a
// hyphen would make CPY document numbers unparseable.
const CODE_RE = /^[A-Z0-9]{2,10}$/

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

export function parseCreateClientInput(raw: unknown): CreateClientInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { name, code, contactEmail, notes } = raw as Record<string, unknown>

  if (!isNonEmptyString(name)) return null
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null
  if (!isOptionalString(contactEmail)) return null
  if (!isOptionalString(notes)) return null

  return {
    name: name.trim(),
    code,
    contactEmail: contactEmail ? contactEmail.trim() : null,
    notes: notes ? notes.trim() : null,
  }
}

/**
 * `raw` is whatever an untrusted caller sends a server action — deliberately
 * destructures only the fields UpdateClientInput declares. A `code` key
 * present in `raw` is silently dropped here, not merely unused by the type:
 * this is what makes "the update action never accepts code" true at runtime,
 * not just at compile time (same pattern as
 * parseUpdateDictionaryEntryInput).
 */
export function parseUpdateClientInput(raw: unknown): UpdateClientInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, name, contactEmail, notes } = raw as Record<string, unknown>

  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  if (name !== undefined && !isNonEmptyString(name)) return null
  if (!isOptionalString(contactEmail)) return null
  if (!isOptionalString(notes)) return null

  return {
    id,
    name: name === undefined ? undefined : (name as string).trim(),
    contactEmail: contactEmail === undefined ? undefined : contactEmail ? (contactEmail as string).trim() : null,
    notes: notes === undefined ? undefined : notes ? (notes as string).trim() : null,
  }
}

export function parseSetClientActiveInput(raw: unknown): SetClientActiveInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, isActive } = raw as Record<string, unknown>
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  if (typeof isActive !== 'boolean') return null
  return { id, isActive }
}

/** Narrower than ActionResult<string>: requireAdmin only ever fails these two ways. */
export type AdminGuardResult =
  | { ok: true; data: string }
  | { ok: false; error: 'unauthenticated' | 'forbidden' }

/**
 * Admin-only guard — see the module comment for why this has no DC branch,
 * unlike requireAdminOrAnyDc (lib/dictionaries-admin.ts) and requireAdminOrDc
 * (lib/project-roles.ts). A non-admin is refused here regardless of whether
 * they hold a `dc` role anywhere, which is exactly the behaviour the task
 * asks to prove against both a plain member and a project DC.
 *
 * Exported since DCS 1a.17: lib/project-mdr.ts needs the identical guard
 * (project creation is admin-only for the same 1a.16 reason), and a second
 * copy of "read profiles.role, compare to admin" is exactly the kind of
 * duplication that drifts. Its result type is deliberately narrower than
 * ActionResult<ClientRow> so a caller with a different error union can reuse
 * it without inheriting ClientError.
 */
export async function requireAdmin(supabase: DbClient): Promise<AdminGuardResult> {
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
      return { ok: false, error: 'duplicate_code' }
    case '23514':
      return { ok: false, error: 'invalid_input' }
    case '42501':
      return { ok: false, error: 'forbidden' }
    default:
      return { ok: false, error: 'db_error', message }
  }
}

export async function createClient(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<ClientRow>> {
  const auth = await requireAdmin(supabase)
  if (!auth.ok) return auth

  const input = parseCreateClientInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const { data, error } = await supabase
    .from('clients')
    .insert({
      name: input.name,
      code: input.code,
      contact_email: input.contactEmail,
      notes: input.notes,
    })
    .select()
    .single()

  if (error) return mapDbError(error.code, error.message)
  return { ok: true, data }
}

/**
 * Diff-only update: reads the current row and writes only the fields that
 * both were provided (not `undefined`) and actually differ from the stored
 * value — never a full-row overwrite. This is what makes the audit_log proof
 * possible ("editing name touches only name") and, more importantly, is
 * correct: an update payload that omits contactEmail/notes must leave them
 * alone rather than clearing them (docs/deferred-tasks.md bb, the bug found
 * in updateDictionaryEntry).
 */
export async function updateClient(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<ClientRow>> {
  const auth = await requireAdmin(supabase)
  if (!auth.ok) return auth

  const input = parseUpdateClientInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const { data: current, error: readError } = await supabase
    .from('clients')
    .select('*')
    .eq('id', input.id)
    .maybeSingle()
  if (readError) return { ok: false, error: 'db_error', message: readError.message }
  if (!current) return { ok: false, error: 'not_found' }

  const patch: TablesUpdate<'clients'> = {}
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name
  if (input.contactEmail !== undefined && input.contactEmail !== current.contact_email) {
    patch.contact_email = input.contactEmail
  }
  if (input.notes !== undefined && input.notes !== current.notes) patch.notes = input.notes

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: current }
  }

  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', input.id)
    .select()
    .single()

  if (error) return mapDbError(error.code, error.message)
  return { ok: true, data }
}

export async function setClientActive(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  const auth = await requireAdmin(supabase)
  if (!auth.ok) return auth

  const input = parseSetClientActiveInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const { data, error } = await supabase
    .from('clients')
    .update({ is_active: input.isActive })
    .eq('id', input.id)
    .select('id, is_active')
    .maybeSingle()

  if (error) return mapDbError(error.code, error.message)
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, data: { id: data.id, isActive: data.is_active } }
}

/**
 * The "Show inactive" decision behind ClientsTable, pulled out as a pure
 * function so it is unit-testable in vitest.config.ts's node-only
 * environment (DCS 1a.12: no jsdom/RTL in apps/dcs — components stay
 * untested-but-trivial wrappers around exported decision functions, see
 * components/IfRole.tsx). Never drops a row from the input: with
 * showInactive=true the output is the full input list (inactive rows kept,
 * including their is_active flag, which is what drives the "greyed out" CSS
 * class in ClientsTable) — a client is filtered from view, never deleted.
 */
export function visibleClients(clients: readonly ClientRow[], showInactive: boolean): ClientRow[] {
  return clients.filter((client) => client.is_active || showInactive)
}

/**
 * Active clients, name-ordered — the contract task 1a.17 (Create Project MDR
 * wizard) is expected to call to populate its client picker. Zero callers
 * today; do not change this shape (active rows only, name order) without
 * checking that consumer once it exists (same convention as
 * getActiveDictionary in lib/dictionaries.ts).
 */
export async function getActiveClients(supabase: DbClient): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw new Error(`getActiveClients: ${error.message}`)
  return data
}
