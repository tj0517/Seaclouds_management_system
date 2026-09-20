// DCS 1b.07: the document profile — Information / Additional attributes on the
// left, the current revision on the right, History from the audit log.
//
// Third screen of the mock-ups (brief §9.3, PIMS annex D). Every tab and the
// panel is its own component so 1b.08 (New Revision), 1b.09 (files) and 1b.11
// (status / Void) each replace one piece instead of reshaping the page.
//
// ACCESS IS RLS, NOT THIS FILE. Which documents this page can render is
// decided by "Project members read documents": a non-member's read returns no
// row and they get notFound(), the same answer as a document that does not
// exist — deliberately, so the page cannot be used to probe whether an id
// exists on a project the caller cannot see. No service-role client, no
// ownership check in code. The same holds for every other read below: the
// revision, its files and the audit rows come through the caller's session, so
// what the reader sees is what their policies return.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@scl/db/server'
import { PageBody, PageHeader } from '@/components/page-chrome'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import CurrentRevisionPanel from '@/components/document-profile/CurrentRevisionPanel'
import DocumentHistoryTab from '@/components/document-profile/DocumentHistoryTab'
import DocumentInformationTab from '@/components/document-profile/DocumentInformationTab'
import {
  CommentsTab,
  PlanTab,
  ReferencesTab,
  RevisionsTab,
  TransmittalsTab,
} from '@/components/document-profile/PlaceholderTabs'
import { fetchUserProjectRoles, hasAnyRole } from '@/lib/auth-helpers'
import {
  cpyFieldMode,
  dictionaryLabel,
  describeAuditRow,
  historyRecordIds,
  PLACEHOLDER_TABS,
} from '@/lib/document-profile'
import {
  getDocument,
  getDocumentHistory,
  getProjectCpyNumbering,
  getRevisionWithFiles,
  HISTORY_LIMIT,
  isUuid,
  listRevisionIds,
} from '@/lib/documents'
import { mdrStatusColor } from '@/lib/mdr'
import { getProfileDirectory } from '@/lib/profile-directory'
import { cn } from '@/lib/utils'

export default async function DocumentProfilePage({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const { documentId } = await params
  if (!isUuid(documentId)) notFound()

  const supabase = await createClient()

  const document = await getDocument(supabase, documentId)
  if (!document) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The CTR code is read separately rather than embedded: its foreign key
  // crosses schemas (dcs.documents -> public.sub_projects) and cross-schema
  // relationships are not in the generated types — see getDocument().
  const [
    { data: project },
    { data: ctr },
    directory,
    cpyNumbering,
    rolesByProject,
    aal,
    revisionIds,
    current,
  ] = await Promise.all([
    supabase.from('projects').select('name, project_code').eq('id', document.project_id).maybeSingle(),
    document.ctr_code
      ? supabase.from('sub_projects').select('code, description').eq('id', document.ctr_code).maybeSingle()
      : Promise.resolve({ data: null }),
    getProfileDirectory(supabase),
    getProjectCpyNumbering(supabase, document.project_id),
    user ? fetchUserProjectRoles(supabase, user.id) : Promise.resolve(new Map()),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    listRevisionIds(supabase, document.id),
    document.current_revision_id ? getRevisionWithFiles(supabase, document.current_revision_id) : Promise.resolve(null),
  ])

  // Roles come from lib/auth-helpers directly, not from the request-cached
  // wrapper in app/data/actions/auth-helpers.ts: that 'use server' module also
  // exports a class and a type, which a server-action file may not, and
  // Turbopack fails to evaluate it (ReferenceError: ProjectRole is not defined).
  // Nothing had imported it at runtime before this page. One call per render
  // needs no cache anyway.

  // Second stage: the audit read needs the revision ids from the first.
  const history = await getDocumentHistory(supabase, historyRecordIds(document.id, revisionIds))

  const nameById = new Map(directory.entries.map((entry) => [entry.id, entry.full_name]))
  const entries = history.map((row) => describeAuditRow(row, nameById))

  // Mirrors the database, does not enforce it — see cpyFieldMode().
  const cpyField = cpyFieldMode({
    cpyNumbering,
    isProjectDc: hasAnyRole(rolesByProject.get(document.project_id) ?? [], ['dc']),
    aal2: aal.data?.currentLevel === 'aal2',
  })

  const projectLabel = project ? `${project.project_code} — ${project.name}` : 'Project'

  return (
    <>
      <nav aria-label="Breadcrumb" className="mx-auto mb-3 w-full max-w-6xl text-sm text-muted-foreground">
        <Link href={`/projects/${document.project_id}/documents`} className="underline underline-offset-4">
          {projectLabel} — documents
        </Link>
        <span aria-hidden className="px-1.5">
          /
        </span>
        <span className="font-mono text-[13px]">{document.scl_doc_number}</span>
      </nav>

      <PageHeader
        title={document.scl_doc_number}
        description={document.title}
        actions={
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium',
              mdrStatusColor(document.workflow_status?.code),
            )}
          >
            {dictionaryLabel(document.workflow_status)}
          </span>
        }
      />

      <PageBody className="max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Tabs defaultValue="information" className="min-w-0">
            {/* Seven tabs are wider than the left column; wrapping keeps every one visible instead of scrolling the active tab into view and clipping the first. */}
            <TabsList className="h-auto max-w-full flex-wrap justify-start">
              <TabsTrigger value="information">Information</TabsTrigger>
              {PLACEHOLDER_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="information">
              <DocumentInformationTab
                document={document}
                project={project}
                ctr={ctr}
                nameById={nameById}
                cpyField={cpyField}
                currentRevisionLabel={current ? current.revision.scl_revision : null}
              />
            </TabsContent>
            <TabsContent value="revisions">
              <RevisionsTab />
            </TabsContent>
            <TabsContent value="plan">
              <PlanTab />
            </TabsContent>
            <TabsContent value="comments">
              <CommentsTab />
            </TabsContent>
            <TabsContent value="references">
              <ReferencesTab />
            </TabsContent>
            <TabsContent value="transmittals">
              <TransmittalsTab />
            </TabsContent>
            <TabsContent value="history">
              <DocumentHistoryTab entries={entries} truncatedAt={history.length >= HISTORY_LIMIT ? HISTORY_LIMIT : null} />
            </TabsContent>
          </Tabs>

          <div className="min-w-0">
            <CurrentRevisionPanel current={current} />
          </div>
        </div>
      </PageBody>
    </>
  )
}
