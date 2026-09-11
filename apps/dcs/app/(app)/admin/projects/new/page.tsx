// DCS 1a.17: Create Project MDR wizard (brief §9.1). Under /admin, so the
// aal2 gate in proxy.ts applies by prefix — an admin without a verified
// second factor never reaches this page (1a.11 / O-14).
//
// The screen is admin-only, matching the database: INSERT on public.projects
// and public.sub_projects is is_admin() alone, and dcs.project_roles' DC
// branch is per project, so nobody can be DC of a project that does not exist
// yet. That is the 1a.16 decision, restated here rather than re-litigated —
// a DC is this screen's *reader*, on /dcs, once the project exists.
//
// Phase 0 mockups were not in the repo, so the stepper layout is this task's
// own decision: one step visible at a time, all state client-side, one
// submit at the end. That shape follows from the write being one transaction
// — there is no half-created project to resume, so there is nothing to
// persist between steps either.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@scl/db/server'
import CreateProjectWizard from '@/components/CreateProjectWizard'
import { getActiveClients } from '@/lib/clients-admin'
import { getProfileDirectory } from '@/lib/profile-directory'

export default async function NewProjectMdrPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-2xl font-bold">New project MDR</h1>
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Only an admin can create a project. A Document Controller is assigned to a project once it exists —
          ask an admin to create it and to add you as DC.
        </div>
        <Link href="/" className="mt-4 inline-block text-sm text-blue-700 hover:underline">
          ← Back to projects
        </Link>
      </div>
    )
  }

  // getActiveClients() is 1a.16's reserved contract for exactly this picker
  // (active rows only, name order) — its first caller. The directory is the
  // same source the 1a.14b team table and "add member" picker use.
  const [clients, directory] = await Promise.all([getActiveClients(supabase), getProfileDirectory(supabase)])

  const candidates = directory.entries
    .map((entry) => ({ id: entry.id, label: entry.full_name ?? `${entry.id.slice(0, 8)}…` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">New project MDR</h1>
        <Link href="/" className="text-sm text-blue-700 hover:underline">
          ← Back to projects
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Everything below is written in a single database transaction — the project, its MDR settings, its team
        and its CTR codes are created together or not at all.
      </p>

      {directory.degraded && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&apos;t load the name directory right now — the team step shows ids instead of names.
        </div>
      )}

      <CreateProjectWizard
        clients={clients.map((client) => ({ id: client.id, name: client.name, code: client.code }))}
        candidates={candidates}
      />
    </div>
  )
}
