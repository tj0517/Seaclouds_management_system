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
import type { Database, Json, TablesUpdate } from '@scl/db'
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
// it is part of the document number, docs/00-glossary.md). Enforced three
// times as of 1a.15b: at the type level here, at runtime in
// parseUpdateDictionaryEntryInput (which only destructures the fields below
// and ignores anything else in the raw input), and — the only one that
// survives a direct PostgREST call bypassing this module — by the database
// trigger dictionaries_code_immutable (migration 20260911091125). The two
// app-layer restrictions are convenience; the trigger is the control.
//
// Every field besides `id` and `label` is optional, and `undefined` means
// "leave unchanged" (as opposed to `null`, which means "clear") —
// updateDictionaryEntry below diffs against the current row and writes only
// what actually changed, the same shape updateClient (lib/clients-admin.ts,
// 1a.16) already has. `label` stays required, unlike updateClient's optional
// `name`: the shipped caller (DictionaryEntryDialog) always sends it and the
// public signature is deliberately unchanged by this task.
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
 * meta with budget_hours set, or — for `null` — with the key REMOVED rather
 * than set to JSON null. readBudgetHours() reads an absent key and a null key
 * identically, and createDictionaryEntry writes `{}` (no key) when no budget
 * is given, so removing keeps "cleared" and "never set" the same single
 * shape. It also keeps the diff honest: a doc_type row with no budget, saved
 * unchanged from the dialog (which sends budgetHours: null), produces a meta
 * identical to the stored one and therefore no UPDATE.
 */
function withBudgetHours(meta: Json, budgetHours: number | null): Json {
  const base: { [key: string]: Json | undefined } =
    typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? { ...meta } : {}
  if (budgetHours === null) {
    delete base.budget_hours
  } else {
    base.budget_hours = budgetHours
  }
  return base
}

/**
 * Structural equality for jsonb values — meta is the one column whose new
 * value is an object, so `!==` would report a change on every save. Key order
 * is irrelevant (Postgres jsonb does not preserve it either), which is why
 * this compares key sets rather than JSON.stringify output.
 */
function jsonEquals(a: Json, b: Json): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => jsonEquals(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        jsonEquals(
          (a as { [key: string]: Json | undefined })[key] ?? null,
          (b as { [key: string]: Json | undefined })[key] ?? null,
        ),
    )
  }
  return false
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
export function parseUpdateDictionaryEntryInput(raw: unknown): UpdateDictionaryEntryInput | null {
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
    // An OMITTED description stays `undefined` ("leave alone"); only an
    // explicit null or empty string clears it. Until 1a.15b this collapsed
    // both to null (`description ? description.trim() : null`) and
    // updateDictionaryEntry wrote it unconditionally, so any caller that did
    // not pass description wiped the stored one — reproduced live on scl-dev
    // during 1a.15's own verification (docs/deferred-tasks.md bb).
    description: description === undefined ? undefined : description ? description.trim() : null,
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

/**
 * Diff-only update (1a.15b): reads the current row and writes only the fields
 * that were both provided (not `undefined`) and actually differ from the
 * stored value — never a full-row overwrite. Same pattern, field for field,
 * as updateClient (lib/clients-admin.ts, 1a.16); the two screens deliberately
 * do not share a generic helper yet (docs/deferred-tasks.md bb).
 *
 * `code` is not diffable here because it is not in the input at all — and
 * from this task on, the database refuses a code change outright (trigger
 * dictionaries_code_immutable), including for a PostgREST call that never
 * goes through this function.
 */
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

  const patch: TablesUpdate<{ schema: 'dcs' }, 'dictionaries'> = {}
  if (input.label !== current.label) patch.label = input.label
  if (input.description !== undefined && input.description !== current.description) {
    patch.description = input.description
  }
  if (input.sortOrder !== undefined && input.sortOrder !== current.sort_order) {
    patch.sort_order = input.sortOrder
  }
  if (budget.value !== undefined) {
    const nextMeta = withBudgetHours(current.meta, budget.value)
    if (!jsonEquals(nextMeta, current.meta)) patch.meta = nextMeta
  }

  // Nothing actually changed: send no UPDATE at all. Not merely an audit_log
  // nicety — set_updated_at fires on every UPDATE, empty payload included, so
  // a resent full row would bump updated_at and make "nothing happened"
  // indistinguishable from a real edit in the row itself.
  if (Object.keys(patch).length === 0) {
    return { ok: true, data: current }
  }

  const { data, error } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .update(patch)
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
