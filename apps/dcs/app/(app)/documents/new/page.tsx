// DCS 1b.04: the New Document screen.
//
// An async RSC that loads every option the form can offer, then hands them to
// one client component. Nothing is fetched in the browser
// (docs/03-conventions.md) — including when the project selector changes,
// which is why the CTR codes and the team of EVERY creatable project are
// loaded here in two bulk queries rather than one query per project.
//
// No page guard beyond "signed in". Unlike /admin/*, this screen is for
// Originators, and the set of projects the form offers is itself the guard's
// visible half: someone holding no ORIG/DC role anywhere sees an empty state,
// not a redirect. RLS is the enforcement either way — a hand-made POST naming
// a project the caller holds no role on is refused by "Originators insert
// documents", which is what supabase/tests/rls_document_register.test.sql
// proves.
import { createClient } from '@scl/db/server'
import { PageBody, PageHeader, EmptyState } from '@/components/page-chrome'
import DocumentCreateForm from '@/components/DocumentCreateForm'
import { getActiveDictionary } from '@/lib/dictionaries'
import { getProfileDirectory } from '@/lib/profile-directory'
import { fetchUserProjectRoles } from '@/lib/auth-helpers'
import {
  creatableProjects,
  getCtrCodesByProject,
  getProjectIdsWithMdr,
  getTeamsByProject,
} from '@/lib/documents'

export default async function NewDocumentPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null // layout already guarantees a session

  const { data: sessionProfile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = sessionProfile?.role === 'admin'

  const [rolesByProject, projectIdsWithMdr, { data: allProjects, error: projectsError }] = await Promise.all([
    fetchUserProjectRoles(supabase, user.id),
    getProjectIdsWithMdr(supabase),
    supabase.from('projects').select('id, name, project_code').eq('is_active', true).order('project_code'),
  ])
  if (projectsError) throw new Error(`Failed to load projects: ${projectsError.message}`)

  const projects = creatableProjects(allProjects ?? [], rolesByProject, projectIdsWithMdr, isAdmin)
  const projectIds = projects.map((project) => project.id)

  const [docTypes, disciplines, areas, languages, ctrByProject, teamsByProject, directory] = await Promise.all([
    getActiveDictionary(supabase, 'doc_type'),
    getActiveDictionary(supabase, 'discipline'),
    getActiveDictionary(supabase, 'area'),
    getActiveDictionary(supabase, 'language'),
    getCtrCodesByProject(supabase, projectIds),
    getTeamsByProject(supabase, projectIds),
    getProfileDirectory(supabase),
  ])

  return (
    <>
      <PageHeader title="New document" description="The SCL number is assigned by the system when you save." />
      <PageBody>
        {projects.length === 0 ? (
          <EmptyState title="No project to create a document in">
            Creating a document needs the Originator or Document Controller role on a project. Ask an administrator
            to add you to one.
          </EmptyState>
        ) : (
          <DocumentCreateForm
            currentUserId={user.id}
            projects={projects}
            docTypes={docTypes}
            disciplines={disciplines}
            areas={areas}
            languages={languages}
            ctrByProject={Object.fromEntries(ctrByProject)}
            teamsByProject={Object.fromEntries(teamsByProject)}
            directory={directory.entries}
          />
        )}
      </PageBody>
    </>
  )
}
