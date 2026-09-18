// DCS 1b.04: the minimal project document list.
//
// Stands in for the acceptance criterion the Notion task wrote as "appears in
// the MDR": the MDR register with its filters, columns and colours is 1b.05
// and does not exist yet, so this list measures the same effect — the document
// was created, it is numbered, and it is visible on its project — without
// pulling 1b.05 forward.
//
// Not a guard: which rows come back is decided by "Project members read
// documents" (RLS). A non-member gets an empty table rather than a redirect,
// and the .eq() below is scoping, not access control — see the note on
// listProjectDocuments in lib/documents.ts about what this query does and does
// not prove.
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createClient } from '@scl/db/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Callout, EmptyState, PageBody, PageHeader, ScrollableTable } from '@/components/page-chrome'
import { getProjectIdsWithMdr, listProjectDocuments } from '@/lib/documents'

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const supabase = await createClient()

  const [{ data: project }, documents, projectIdsWithMdr] = await Promise.all([
    supabase.from('projects').select('name, project_code').eq('id', projectId).maybeSingle(),
    listProjectDocuments(supabase, projectId),
    getProjectIdsWithMdr(supabase),
  ])
  if (!project) notFound()

  return (
    <>
      <PageHeader
        title={`${project.project_code ?? project.name} — documents`}
        description={project.name}
        actions={
          <Button asChild>
            <Link href="/documents/new">
              <Plus className="mr-2 h-4 w-4" />
              New document
            </Link>
          </Button>
        }
      />
      <PageBody>
        {!projectIdsWithMdr.has(projectId) ? (
          <Callout tone="warning">
            DCS does not run this project: it has no MDR configuration, so no document can be created on it. Its
            Document Controller must create the project MDR first.
          </Callout>
        ) : null}

        {documents.length === 0 ? (
          <EmptyState title="No documents yet">
            Documents created on this project appear here with the SCL number the system assigns them.
          </EmptyState>
        ) : (
          <ScrollableTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SCL number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Discipline</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Lang</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/documents/${document.id}`} className="underline underline-offset-4">
                        {document.scl_doc_number}
                      </Link>
                    </TableCell>
                    <TableCell>{document.title}</TableCell>
                    <TableCell>{document.doc_type?.code ?? '—'}</TableCell>
                    <TableCell>{document.discipline?.code ?? '—'}</TableCell>
                    <TableCell>{document.area?.code ?? '—'}</TableCell>
                    <TableCell>{document.language?.code ?? '—'}</TableCell>
                    <TableCell>
                      <Badge>{document.workflow_status?.label ?? '—'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollableTable>
        )}
      </PageBody>
    </>
  )
}
