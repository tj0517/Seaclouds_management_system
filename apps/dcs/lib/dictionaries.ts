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
 * workflow_status codes that belong to a REVISION and never to a document.
 *
 * dcs.revisions.status_id and dcs.documents.workflow_status_id both point into
 * the one `workflow_status` dictionary, so a status that only a revision can be
 * in (SUPERSEDED, set by the database on a revision a newer one has replaced —
 * DCS 1b.08) is a row in the same list as NOT_STARTED … VOID. Every list that
 * offers a status to filter or set a DOCUMENT by goes through
 * documentStatusOptions() so it is not offered there.
 */
export const REVISION_ONLY_STATUS_CODES: readonly string[] = ['SUPERSEDED']

/**
 * The workflow_status rows a picker or filter for DOCUMENT statuses may offer.
 *
 * A filter on the list, not on the data: a document that somehow carries
 * SUPERSEDED (nothing in the database stops it — docs/deferred-tasks.md yy) is
 * still displayed as what it is wherever its single status is shown. Hiding
 * that there would hide a wrong state.
 */
export function documentStatusOptions<T extends { code: string }>(statuses: readonly T[]): T[] {
  return statuses.filter((status) => !REVISION_ONLY_STATUS_CODES.includes(status.code))
}

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
