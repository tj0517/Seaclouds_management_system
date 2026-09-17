// DCS 1a.16: clients admin screen. RLS narrows the rows ("Members of client
// projects read clients" — admin sees all, everyone else only clients tied to
// their own projects); edit controls render only for admin (mirrors
// requireAdmin in lib/clients-admin.ts — deliberately NOT admin-or-DC, see
// docs/02-data-model.md's public.clients section). Under the aal2 gate in
// proxy.ts (/admin* prefix).
//
// DCS 1a.21a — BEHAVIOUR CHANGE: this page used to render for every
// signed-in user; it is now guarded, and anyone who is neither an admin nor
// the DC of any project is redirected to /. Note the guard is WIDER than the
// edit right on purpose: a DC reaches this screen and still sees it
// read-only, because clients drive CPY numbering and a DC needs to read
// them. No policy and no write guard changed. See docs/03-conventions.md,
// "Dostęp do ekranów /admin w DCS".
import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import ClientsTable from '@/components/ClientsTable'
import { Callout, PageBody, PageHeader } from '@/components/page-chrome'
import { canOpenAdminScreens } from '@/lib/auth-helpers'

export default async function ClientsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: clients, error: clientsError }, { data: projectRows, error: projectsError }] =
    await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      supabase.from('clients').select('*').order('name'),
      supabase.from('projects').select('client_id').not('client_id', 'is', null),
    ])
  if (clientsError) throw new Error(`Failed to load clients: ${clientsError.message}`)
  if (projectsError) throw new Error(`Failed to load project counts: ${projectsError.message}`)

  const isAdmin = profile?.role === 'admin'
  if (!(await canOpenAdminScreens(supabase, user.id, isAdmin))) redirect('/')

  const projectCounts: Record<string, number> = {}
  for (const row of projectRows ?? []) {
    if (!row.client_id) continue
    projectCounts[row.client_id] = (projectCounts[row.client_id] ?? 0) + 1
  }

  return (
    <PageBody>
      <PageHeader
        title="Clients"
        description="Clients drive CPY document numbering. Clients are never deleted — deactivate instead."
      />
      {/* Wording unchanged: docs/demo/1a21-demo-script.md's presenter smoke
          check reads this sentence back verbatim as the DC-vs-admin contrast. */}
      {!isAdmin && <Callout>Read-only — only an admin can add or edit clients here.</Callout>}
      <ClientsTable clients={clients ?? []} projectCounts={projectCounts} canEdit={isAdmin} />
    </PageBody>
  )
}
