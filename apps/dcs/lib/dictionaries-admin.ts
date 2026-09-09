// DCS 1a.15: write side of dcs.dictionaries — the generic dictionaries admin
// screen. Independent of Next.js (same split as lib/project-roles.ts): takes
// any typed Supabase client, so this runs from a server action (session
// client, RLS applies) and from a verification script. The 'use server'
// wrappers live in app/data/actions/dictionaries.ts.
//
// RLS already enforces admin-or-DC-at-aal2 for INSERT/UPDATE and admin-only
// for DELETE (migrations 20260904081501, 20260904125543, 20260904160000) —
// this guard is the app's own line of defence in front of that (CLAUDE.md:
// "RLS is the second line; the app guard is the first — both must deny"),
// mirroring is_any_doc_controller() exactly rather than calling it via RPC,
// the same style requireAdminOrDc (lib/project-roles.ts) already uses for the
// project-scoped case.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@scl/db'
import { DICT_TYPES, type DictionaryRow, type DictType } from './dictionaries'

export type DictionaryEntryError =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'duplicate_code'
  | 'not_found'
  | 'db_error'

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DictionaryEntryError; message?: string }

export type CreateDictionaryEntryInput = {
  dictType: DictType
  code: string
  label: string
  description?: string | null
  sortOrder?: number
  /** Only meaningful (and only accepted) when dictType is 'doc_type'. */
  budgetHours?: number | null
}

// Deliberately has no `code` field — the update server action must not be
// able to accept one, even from an untrusted raw payload (code is immutable:
// it is part of the document number, docs/00-glossary.md). Enforced twice:
// at the type level here, and at runtime in parseUpdateInput, which only
// destructures the fields below and ignores anything else in the raw input.
export type UpdateDictionaryEntryInput = {
  id: string
  label: string
  description?: string | null
  sortOrder?: number
  /** Only meaningful (and only accepted) when the row's dict_type is 'doc_type'. */
  budgetHours?: number | null
}

export type SetDictionaryEntryActiveInput = {
  id: string
  isActive: boolean
}

type DbClient = SupabaseClient<Database>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDictType(value: unknown): value is DictType {
  return typeof value === 'string' && (DICT_TYPES as readonly string[]).includes(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isOptionalSortOrder(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value))
}

/**
 * Reads meta.budget_hours out of a jsonb value defensively — meta has no DB
 * CHECK on shape (docs/deferred-tasks.md r), so a value written before this
 * screen existed, or by a future different writer, might not carry a number.
 */
function readBudgetHours(meta: Json): number | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const value = (meta as Record<string, Json>).budget_hours
  return typeof value === 'number' ? value : null
}

/**
 * Validates a raw budgetHours field against the dictType it would apply to.
 * - undefined: not provided, always fine (create: no budget set; update: leave unchanged).
 * - null: explicit clear, only fine for doc_type.
 * - number: must be finite and >= 0, only fine for doc_type.
 * Any budgetHours value at all for a non-doc_type dictionary is rejected —
 * the task only asks the column to exist for doc_type.
 */
function parseBudgetHours(
  dictType: DictType,
  raw: unknown,
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined }
  if (dictType !== 'doc_type') return { ok: false }
  if (raw === null) return { ok: true, value: null }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return { ok: true, value: raw }
  return { ok: false }
}

export function parseCreateDictionaryEntryInput(raw: unknown): CreateDictionaryEntryInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { dictType, code, label, description, sortOrder, budgetHours } = raw as Record<string, unknown>

  if (!isDictType(dictType)) return null
  if (!isNonEmptyString(code)) return null
  if (!isNonEmptyString(label)) return null
  if (!isOptionalString(description)) return null
  if (!isOptionalSortOrder(sortOrder)) return null
  const budget = parseBudgetHours(dictType, budgetHours)
  if (!budget.ok) return null

  return {
    dictType,
    code: code.trim(),
    label: label.trim(),
    description: description ? description.trim() : null,
    sortOrder: sortOrder ?? 0,
    budgetHours: budget.value ?? null,
  }
}

/**
 * `raw` is whatever an untrusted caller sends a server action — deliberately
 * destructures only the fields UpdateDictionaryEntryInput declares. A `code`
 * (or `dictType`) key present in `raw` is silently dropped here, not merely
 * unused by the type: this is what makes "the update action never accepts
 * code" true at runtime, not just at compile time.
 */
export function parseUpdateDictionaryEntryInput(raw: unknown): Omit<UpdateDictionaryEntryInput, 'budgetHours'> & {
  budgetHours?: number | null
} | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, label, description, sortOrder, budgetHours } = raw as Record<string, unknown>

  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  if (!isNonEmptyString(label)) return null
  if (!isOptionalString(description)) return null
  if (!isOptionalSortOrder(sortOrder)) return null
  if (budgetHours !== undefined && budgetHours !== null && typeof budgetHours !== 'number') return null

  return {
    id,
    label: label.trim(),
    description: description ? description.trim() : null,
    sortOrder,
    budgetHours: budgetHours as number | null | undefined,
  }
}

export function parseSetDictionaryEntryActiveInput(raw: unknown): SetDictionaryEntryActiveInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, isActive } = raw as Record<string, unknown>
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  if (typeof isActive !== 'boolean') return null
  return { id, isActive }
}

/**
 * Admin-or-any-DC guard, project-less because dcs.dictionaries has no
 * project_id (1a.07) — the app-layer mirror of public.is_any_doc_controller()
 * (1a.09b). Does not check aal2: that is a session-transport property RLS
 * enforces from the JWT claim directly (20260904160000_dictionaries_dc_aal2),
 * which this guard has no independent way to re-verify from the client;
 * proxy.ts's redirect-to-/mfa is the UX front for it (docs/adr, 1a.11).
 */
async function requireAdminOrAnyDc(supabase: DbClient): Promise<ActionResult<string>> {
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

  const { data: dcRows, error: dcError } = await supabase
    .schema('dcs')
    .from('project_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'dc')
    .limit(1)
  if (dcError) return { ok: false, error: 'db_error', message: dcError.message }
  if ((dcRows?.length ?? 0) === 0) return { ok: false, error: 'forbidden' }

  return { ok: true, data: user.id }
}

function mapDbError(code: string | undefined, message: string): ActionResult<never> {
  switch (code) {
    case '23505':
      return { ok: false, error: 'duplicate_code' }
    case '42501':
      return { ok: false, error: 'forbidden' }
    default:
      return { ok: false, error: 'db_error', message }
  }
}

export async function createDictionaryEntry(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<DictionaryRow>> {
  const auth = await requireAdminOrAnyDc(supabase)
  if (!auth.ok) return auth

  const input = parseCreateDictionaryEntryInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const meta: Json = input.dictType === 'doc_type' && input.budgetHours !== null
    ? { budget_hours: input.budgetHours }
    : {}

  const { data, error } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .insert({
      dict_type: input.dictType,
      code: input.code,
      label: input.label,
      description: input.description,
      sort_order: input.sortOrder,
      meta,
    })
    .select()
    .single()

  if (error) return mapDbError(error.code, error.message)
  return { ok: true, data }
}

export async function updateDictionaryEntry(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<DictionaryRow>> {
  const auth = await requireAdminOrAnyDc(supabase)
  if (!auth.ok) return auth

  const input = parseUpdateDictionaryEntryInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const { data: current, error: readError } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .select('*')
    .eq('id', input.id)
    .maybeSingle()
  if (readError) return { ok: false, error: 'db_error', message: readError.message }
  if (!current) return { ok: false, error: 'not_found' }

  const budget = parseBudgetHours(current.dict_type as DictType, input.budgetHours)
  if (!budget.ok) return { ok: false, error: 'invalid_input' }

  const meta: Json =
    budget.value === undefined
      ? current.meta
      : { ...(typeof current.meta === 'object' && current.meta !== null && !Array.isArray(current.meta) ? current.meta : {}), budget_hours: budget.value }

  const { data, error } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .update({
      label: input.label,
      description: input.description,
      sort_order: input.sortOrder ?? current.sort_order,
      meta,
    })
    .eq('id', input.id)
    .select()
    .single()

  if (error) return mapDbError(error.code, error.message)
  return { ok: true, data }
}

export async function setDictionaryEntryActive(
  supabase: DbClient,
  rawInput: unknown,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  const auth = await requireAdminOrAnyDc(supabase)
  if (!auth.ok) return auth

  const input = parseSetDictionaryEntryActiveInput(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }

  const { data, error } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .update({ is_active: input.isActive })
    .eq('id', input.id)
    .select('id, is_active')
    .maybeSingle()

  if (error) return mapDbError(error.code, error.message)
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, data: { id: data.id, isActive: data.is_active } }
}

export { readBudgetHours }
