// DCS 1b.04: just enough document profile to land on after creating one.
//
// The FULL profile — Information / Additional attributes / the current
// revision panel — is 1b.07, and the Revisions tab and the working New
// Revision window are 1b.08. This page is deliberately the minimum the
// acceptance criterion names: the assigned SCL number, what was saved, and a
// "New Revision" action that is a visible stub.
//
// No ownership check in code. Which documents this page can render is decided
// by "Project members read documents" (RLS): a non-member's read returns no
// row and they get notFound(), which is the same answer as a document that
// does not exist — deliberately, so the page cannot be used to probe whether
// an id exists on a project the caller cannot see.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@scl/db/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout, PageBody, PageHeader } from '@/components/page-chrome'
import { getProfileDirectory } from '@/lib/profile-directory'
import { getDocument } from '@/lib/documents'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export default async function DocumentProfilePage({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const { documentId } = await params
  const supabase = await createClient()

  const document = await getDocument(supabase, documentId)
  if (!document) notFound()

  // The CTR code is read separately rather than embedded: its foreign key
  // crosses schemas (dcs.documents -> public.sub_projects) and cross-schema
  // relationships are not in the generated types — see getDocument().
  const [{ data: project }, { data: ctr }, directory] = await Promise.all([
    supabase.from('projects').select('name, project_code').eq('id', document.project_id).maybeSingle(),
    document.ctr_code
      ? supabase.from('sub_projects').select('code, description').eq('id', document.ctr_code).maybeSingle()
      : Promise.resolve({ data: null }),
    getProfileDirectory(supabase),
  ])
  const nameById = new Map(directory.entries.map((entry) => [entry.id, entry.full_name]))
  const person = (id: string | null) => (id === null ? '—' : (nameById.get(id) ?? `${id.slice(0, 8)}…`))

  return (
    <>
      <PageHeader
        title={document.scl_doc_number}
        description={document.title}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge>{document.workflow_status?.label ?? '—'}</Badge>
          <Link
            href={`/projects/${document.project_id}/documents`}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            {project?.project_code ?? 'Project'} — all documents
          </Link>
        </div>

        <dl className="grid max-w-3xl gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
          <Field label="Document type">
            {document.doc_type ? `${document.doc_type.code} — ${document.doc_type.label}` : '—'}
          </Field>
          <Field label="Discipline">
            {document.discipline ? `${document.discipline.code} — ${document.discipline.label}` : '—'}
          </Field>
          <Field label="Area">{document.area ? `${document.area.code} — ${document.area.label}` : '—'}</Field>
          <Field label="Language">{document.language?.code ?? '—'}</Field>
          <Field label="CTR code">{ctr ? ctr.code : "—"}</Field>
          <Field label="Budget hours">{document.budget_hours ?? '—'}</Field>
          <Field label="Originator">{person(document.originator_id)}</Field>
          <Field label="Checker">{person(document.checker_id)}</Field>
          <Field label="Approver">{person(document.approver_id)}</Field>
          {/* The CPY number is shown but not editable here: setCpyNumber and the
              editable field belong to 1b.07, and writing it needs the project's
              DC at aal2 (trigger documents_numbering_dc_only, 1b.03). */}
          <Field label="Client (CPY) number">{document.cpy_doc_number ?? '—'}</Field>
        </dl>

        <div className="mt-6">
          {/* 1b.08 owns the New Revision window. Rendered disabled rather than
              omitted so the profile shows where the next step will be, and
              disabled rather than wired to a placeholder because a button that
              half-works is worse than one that says it is not ready. */}
          <Button disabled>New Revision</Button>
          <Callout tone="info">
            This document has no revision yet. The New Revision window arrives with DCS 1b.08 — until then a document
            is created, numbered and staffed, and nothing is issued.
          </Callout>
        </div>
      </PageBody>
    </>
  )
}
