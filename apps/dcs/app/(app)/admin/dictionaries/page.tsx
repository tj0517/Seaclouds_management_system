// DCS 1a.15: one generic screen for every dcs.dictionaries dict_type — tabs
// derived from DICT_TYPES (lib/dictionaries.ts), which must stay in sync with
// the CHECK constraint (scripts/check-dict-types.sh, rls_dictionaries.test.sql).
// Read-only for every signed-in user (RLS: "Authenticated users can read
// dictionaries" — all rows, inactive included); edit controls render only for
// admin or any project's DC (mirrors requireAdminOrAnyDc in
// lib/dictionaries-admin.ts). Under the aal2 gate in proxy.ts (/admin* prefix).
import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import DictionariesClient from '@/components/DictionariesClient'
import { DICT_TYPES, type DictionaryRow, type DictType } from '@/lib/dictionaries'

export default async function DictionariesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: dcRows }, { data: allRows, error: rowsError }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.schema('dcs').from('project_roles').select('id').eq('user_id', user.id).eq('role', 'dc').limit(1),
    supabase.schema('dcs').from('dictionaries').select('*').order('dict_type').order('sort_order').order('code'),
  ])
  if (rowsError) throw new Error(`Failed to load dictionaries: ${rowsError.message}`)

  const canEdit = profile?.role === 'admin' || (dcRows?.length ?? 0) > 0

  const rowsByType = Object.fromEntries(DICT_TYPES.map((type) => [type, [] as DictionaryRow[]])) as Record<
    DictType,
    DictionaryRow[]
  >
  for (const row of allRows ?? []) {
    const type = row.dict_type as DictType
    if (type in rowsByType) rowsByType[type].push(row)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold">Dictionaries</h1>
      <p className="mb-6 text-sm text-gray-500">
        Company-wide code lists used across every DCS project. Entries are never deleted — deactivate instead.
      </p>
      {!canEdit && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Read-only — only an admin or a Document Controller can change dictionaries here.
        </div>
      )}
      <DictionariesClient rowsByType={rowsByType} canEdit={canEdit} />
    </div>
  )
}
