import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@scl/db/server'
import NavLinkStatus from '@/components/NavLinkStatus'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Callout, EmptyState, PageBody, PageHeader, ScrollableTable } from '@/components/page-chrome'
import { isAdminOrProjectDc, type ProjectRole } from '@/lib/auth-helpers'
import { resolveProjectListFilter } from '@/lib/project-list'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Layout already guarantees a session; RLS queries below still need the id.
  if (!user) return null

  const { data: sessionProfile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = sessionProfile?.role === 'admin'

  // DCS 1a.14b: public.projects' own SELECT policy ("Widoczność projektów")
  // still admits every signed-in user — that policy is shared, load-bearing
  // Timesheet infrastructure and stays untouched (see the migration comment
  // on public.dcs_profile_directory()). The filter is entirely app-side:
  // admin gets no filter (the policy already shows everyone everything);
  // everyone else is narrowed to projects they hold a dcs.project_roles row
  // on. A member with zero roles gets a clear empty-state message, not an
  // error; a read failure degrades to the same empty list plus its own
  // distinct message (fails closed on purpose — see lib/project-list.ts).
  const filter = await resolveProjectListFilter(supabase, user.id, isAdmin)

  // DCS 1a.21a: the same roles the filter already read, reused to decide
  // which rows get a "Team" link. Empty for an admin — the filter short-
  // circuits before reading roles, and isAdminOrProjectDc never consults the
  // map for one.
  const rolesByProject = filter.kind === 'ids' ? filter.rolesByProject : new Map<string, ProjectRole[]>()

  let projects: {
    id: string
    name: string
    description: string | null
    project_code: string | null
    is_active: boolean | null
  }[] = []
  if (filter.kind === 'all' || (filter.kind === 'ids' && filter.ids.length > 0)) {
    let query = supabase.from('projects').select('id, name, description, project_code, is_active').order('name')
    if (filter.kind === 'ids') query = query.in('id', filter.ids)
    const { data, error } = await query
    if (error) throw new Error(`Failed to load projects: ${error.message}`)
    projects = data ?? []
  }

  // DCS 1a.17, acceptance criterion 2: the DC of a project must see it here
  // "with team and cycle". Both extra reads below are UNFILTERED in code —
  // which rows come back is the database's decision (dcs.project_roles'
  // "Project members read project roles"; mdr_settings' SELECT policy admits
  // any signed-in user), so this stays a valid RLS proof by
  // docs/03-conventions.md's rule.
  const { data: teamRows, error: teamError } = await supabase.schema('dcs').from('project_roles').select('project_id')
  if (teamError) throw new Error(`Failed to load project teams: ${teamError.message}`)
  const teamSizeByProject = new Map<string, number>()
  for (const row of teamRows ?? []) {
    teamSizeByProject.set(row.project_id, (teamSizeByProject.get(row.project_id) ?? 0) + 1)
  }

  // Source of the Cycle column. Unfiltered in code on purpose, same as the
  // team read above: mdr_settings' SELECT policy admits any signed-in user,
  // so the database decides the row set.
  //
  // DCS 1a.21a: this read is all that remains of the "RLS probe" block that
  // lived here from 1a.05 through 1a.17 (deferred-tasks (x), first bullet).
  // The probe's demonstration half — a second, deliberately CHECK-violating
  // INSERT on every render, plus the blue panel reporting its SQLSTATE — is
  // gone: diagnostic UI has no place in front of a client, and the RLS proof
  // it stood for is covered by supabase/tests/rls_mdr_settings.test.sql.
  // Ownership moved from 1b.05 to 1a.21a when the 1a gate demo needed it
  // removed before the MDR register exists.
  const { data: mdrSettings, error: mdrError } = await supabase
    .schema('dcs')
    .from('mdr_settings')
    .select('project_id, cycle_idc_to_ifr, cycle_ifr_to_retcom, cycle_retcom_to_ifc')

  if (mdrError) {
    throw new Error(`Failed to load MDR settings: ${mdrError.message}`)
  }

  const settingsByProject = new Map(mdrSettings.map((row) => [row.project_id, row]))

  // DCS 1a.24: presentation only below this line. Which rows appear, who gets
  // a Team link and what the two degraded messages say are unchanged — the
  // decisions still come from resolveProjectListFilter() and
  // isAdminOrProjectDc(), and app/(app)/nav.test.ts pins the Team links.
  return (
    <PageBody>
      <PageHeader
        title="Projects"
        description={
          filter.kind === 'all' ? 'Every project — you are an admin.' : 'Projects where you hold a DCS role.'
        }
        actions={
          isAdmin ? (
            <Link
              href="/admin/projects/new"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New project MDR
              <NavLinkStatus />
            </Link>
          ) : null
        }
      />

      {filter.kind === 'degraded' && (
        <Callout tone="error">
          Couldn&apos;t load your project roles right now — showing no projects. Try refreshing; if this
          persists, contact an admin.
        </Callout>
      )}

      {filter.kind === 'ids' && filter.ids.length === 0 ? (
        <EmptyState title="No projects yet">
          You have no DCS project roles yet — ask a Document Controller or admin to add you to a project.
        </EmptyState>
      ) : projects.length === 0 ? (
        filter.kind === 'degraded' ? null : <EmptyState title="No projects to show" />
      ) : (
        <ScrollableTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[7.5rem]">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-[7rem]">Cycle</TableHead>
                <TableHead className="w-[7rem]">Team</TableHead>
                <TableHead className="w-[6rem]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => {
                const settings = settingsByProject.get(project.id)
                return (
                  <TableRow key={project.id}>
                    <TableCell className="font-mono text-xs">{project.project_code ?? '—'}</TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/projects/${project.id}`}
                        className="inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline"
                      >
                        {project.name}
                        <NavLinkStatus />
                      </Link>
                      {project.description ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">{project.description}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {settings
                        ? `${settings.cycle_idc_to_ifr}/${settings.cycle_ifr_to_retcom}/${settings.cycle_retcom_to_ifc}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="tabular-nums">{teamSizeByProject.get(project.id) ?? 0}</span>
                      {/* DCS 1a.21a: an editor's entry point, not an access
                          decision — shown only to whoever may change this
                          project's team (admin, or its own DC), mirroring
                          requireAdminOrDc. The project name beside it already
                          links to the same page for every reader. */}
                      {isAdminOrProjectDc(isAdmin, rolesByProject, project.id) && (
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="ml-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {/* No <NavLinkStatus/> here, unlike every other
                              link on this screen, and not an oversight:
                              app/(app)/nav.test.ts asserts this link's
                              children are exactly the string 'Team', so a
                              sibling indicator inside it would fail a test
                              1a.24 must not edit — and useLinkStatus() only
                              works from inside its own <Link>. The click is
                              still acknowledged immediately: it lands on
                              /admin/projects/[projectId], whose loading.tsx
                              skeleton paints on the first frame. */}
                          Team
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      {project.is_active ? (
                        <Badge className="border-transparent bg-success-bg text-success hover:bg-success-bg">
                          active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          inactive
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </ScrollableTable>
      )}
    </PageBody>
  )
}
