// DCS 1a.15: one generic screen for every dcs.dictionaries dict_type — tabs
// derived from DICT_TYPES (lib/dictionaries.ts), which must stay in sync with
// the CHECK constraint (scripts/check-dict-types.sh, rls_dictionaries.test.sql).
// Edit controls render only for admin or any project's DC (mirrors
// requireAdminOrAnyDc in lib/dictionaries-admin.ts). Under the aal2 gate in
// proxy.ts (/admin* prefix).
//
// DCS 1a.21a — BEHAVIOUR CHANGE: this page used to render read-only for
// every signed-in user; it is now guarded, and anyone who is neither an
// admin nor the DC of any project is redirected to /. The RLS policy
// underneath is unchanged and still permissive ("Authenticated users can
// read dictionaries" — all rows, inactive included): this is a navigation
// decision about who is shown company-wide configuration screens, not a new
// data protection claim. See docs/03-conventions.md, "Dostęp do ekranów
// /admin w DCS".
import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import DictionariesClient from '@/components/DictionariesClient'
import { PageBody, PageHeader } from '@/components/page-chrome'
import { canOpenAdminScreens } from '@/lib/auth-helpers'
import { DICT_TYPES, type DictionaryRow, type DictType } from '@/lib/dictionaries'

export default async function DictionariesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: allRows, error: rowsError }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.schema('dcs').from('dictionaries').select('*').order('dict_type').order('sort_order').order('code'),
  ])
  if (rowsError) throw new Error(`Failed to load dictionaries: ${rowsError.message}`)

  // Guard and edit right coincide on this screen: both are "admin or the DC
  // of any project" — the page guard by 1a.21a's decision, the edit right by
  // 1a.15's requireAdminOrAnyDc (lib/dictionaries-admin.ts). One read, used
  // for both, rather than two identical queries pretending to be different
  // questions. The consequence is that this screen has no read-only state
  // left: 1a.15's "Read-only — only an admin or a Document Controller…"
  // banner was removed here as unreachable rather than kept as dead UI. If
  // the guard is ever loosened, this line is what has to split back in two.
  const canEdit = await canOpenAdminScreens(supabase, user.id, profile?.role === 'admin')
  if (!canEdit) redirect('/')

  const rowsByType = Object.fromEntries(DICT_TYPES.map((type) => [type, [] as DictionaryRow[]])) as Record<
    DictType,
    DictionaryRow[]
  >
  for (const row of allRows ?? []) {
    const type = row.dict_type as DictType
    if (type in rowsByType) rowsByType[type].push(row)
  }

  return (
    <PageBody>
      <PageHeader
        title="Dictionaries"
        description="Company-wide code lists used across every DCS project. Entries are never deleted — deactivate instead."
      />
      <DictionariesClient rowsByType={rowsByType} canEdit={canEdit} />
    </PageBody>
  )
}
