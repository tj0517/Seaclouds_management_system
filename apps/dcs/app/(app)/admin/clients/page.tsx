// DCS 1a.16: clients admin screen. Read-only for every signed-in user (RLS:
// "Members of client projects read clients" — admin sees all, everyone else
// only clients tied to their own projects); edit controls render only for
// admin (mirrors requireAdmin in lib/clients-admin.ts — deliberately NOT
// admin-or-DC, see docs/02-data-model.md's public.clients section). Under the
// aal2 gate in proxy.ts (/admin* prefix).
import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import ClientsTable from '@/components/ClientsTable'

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

  const projectCounts: Record<string, number> = {}
  for (const row of projectRows ?? []) {
    if (!row.client_id) continue
    projectCounts[row.client_id] = (projectCounts[row.client_id] ?? 0) + 1
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold">Clients</h1>
      <p className="mb-6 text-sm text-gray-500">
        Clients drive CPY document numbering. Clients are never deleted — deactivate instead.
      </p>
      {!isAdmin && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Read-only — only an admin can add or edit clients here.
        </div>
      )}
      <ClientsTable clients={clients ?? []} projectCounts={projectCounts} canEdit={isAdmin} />
    </div>
  )
}
