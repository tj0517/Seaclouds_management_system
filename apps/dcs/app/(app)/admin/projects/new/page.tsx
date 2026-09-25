// DCS 1b.24: "Enable DCS" wizard, replacing the 1a.17 Create Project MDR
// wizard. Under /admin, so the aal2 gate in proxy.ts applies by prefix — an
// admin without a verified second factor never reaches this page (1a.11 /
// O-14).
//
// The screen is admin-only, matching the database: the ALL policies on
// dcs.mdr_settings and dcs.project_roles are is_admin() alone (or a DC's own
// project, which cannot be true here — a project with no DCS has no
// project_roles rows to be DC of). DCS no longer creates projects at all
// (client agreement, tj 2026-09-25, docs/tasks/DCS-1b.24.md); it only turns
// itself on for a project Timesheet already owns.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@scl/db/server'
import EnableDcsWizard from '@/components/EnableDcsWizard'
import NavLinkStatus from '@/components/NavLinkStatus'
import { Callout, PageBody, PageHeader } from '@/components/page-chrome'
import { getProjectsWithoutMdr } from '@/lib/project-mdr'
import { getProfileDirectory } from '@/lib/profile-directory'

export default async function EnableDcsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'

  if (!isAdmin) {
    return (
      <PageBody className="max-w-3xl">
        <PageHeader title="Enable DCS" />
        <Callout>
          Only an admin can enable DCS for a project. Ask an admin to enable it and to add you as Document
          Controller.
        </Callout>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Back to projects
          <NavLinkStatus />
        </Link>
      </PageBody>
    )
  }

  // The directory is the same source the 1a.14b team table and "add member"
  // picker use.
  const [projects, directory] = await Promise.all([getProjectsWithoutMdr(supabase), getProfileDirectory(supabase)])

  const candidates = directory.entries
    .map((entry) => ({ id: entry.id, label: entry.full_name ?? `${entry.id.slice(0, 8)}…` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="Enable DCS"
        description="Pick a project Timesheet already runs. Its identity (code, name, client, process type, year) stays Timesheet's — everything below is DCS-only, and is written in a single database transaction."
        actions={
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
          >
            ← Back to projects
            <NavLinkStatus />
          </Link>
        }
      />

      {directory.degraded && (
        <Callout tone="error">
          Couldn&apos;t load the name directory right now — the team step shows ids instead of names.
        </Callout>
      )}

      <EnableDcsWizard projects={projects} candidates={candidates} />
    </PageBody>
  )
}
