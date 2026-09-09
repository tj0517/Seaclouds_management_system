// DCS 1a.07: read side of dcs.dictionaries, independent of Next.js — takes any
// typed Supabase client (same shape as lib/project-roles.ts), so it runs from
// an RSC page, a server action or a script alike. RLS applies: every signed-in
// user may read dictionaries, so no guard is needed here.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@scl/db'

export type DictionaryRow = Tables<{ schema: 'dcs' }, 'dictionaries'>

/**
 * Dictionary types accepted by the CHECK constraint on dcs.dictionaries.dict_type
 * (migration 20260904081501). `dict_type` is text, not an enum, so the generated
 * types cannot carry this list — keep it in sync with the CHECK when a type is
 * added; rls_dictionaries.test.sql asserts the database side and
 * scripts/check-dict-types.sh asserts this list against it in CI.
 */
export const DICT_TYPES = [
  'doc_type',
  'discipline',
  'area',
  'language',
  'acceptance_code',
  'workflow_status',
  'workflow_step',
] as const

export type DictType = (typeof DICT_TYPES)[number]

/** Display labels for the dictionaries screen tabs (DCS 1a.15) — glossary terms, not DB codes. */
export const DICT_TYPE_LABELS: Record<DictType, string> = {
  doc_type: 'Document Type',
  discipline: 'Discipline',
  area: 'Area',
  language: 'Language',
  acceptance_code: 'Acceptance Code',
  workflow_status: 'Workflow Status',
  workflow_step: 'Workflow Step',
}

type DbClient = SupabaseClient<Database>

/**
 * Active entries of one dictionary, in sort_order (ties broken by code so the
 * order is stable). Inactive rows are excluded on purpose: this is the "what a
 * form may offer" view. To resolve a historical code, query by id/code without
 * the is_active filter.
 *
 * This is the contract 1a.17 (document creation wizard) and 1b.04 (document
 * form) call to populate their dropdowns — do not change its return shape
 * (active rows only, sort_order/code order) without checking those callers.
 */
export async function getActiveDictionary(
  supabase: DbClient,
  type: DictType,
): Promise<DictionaryRow[]> {
  const { data, error } = await supabase
    .schema('dcs')
    .from('dictionaries')
    .select('*')
    .eq('dict_type', type)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true })

  if (error) throw new Error(`getActiveDictionary(${type}): ${error.message}`)
  return data
}
