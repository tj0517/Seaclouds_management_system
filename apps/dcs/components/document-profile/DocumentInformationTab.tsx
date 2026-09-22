// DCS 1b.07: the Information tab — what the register holds about this
// document, with the remaining columns behind a collapsible section.
//
// A server component: it only lays out values the page already read. The one
// interactive part is the CPY field, a client component of its own. Native
// <details> rather than a Radix Collapsible: no new dependency for a
// disclosure the browser already does, and it keeps the PR out of the
// lockfile that the Timesheet project shares.
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import CpyNumberField from './CpyNumberField'
import DocumentStatusControl from './DocumentStatusControl'
import VoidDocumentDialog from './VoidDocumentDialog'
import type { CpyFieldMode } from '@/lib/document-profile'
import { dictionaryLabel, formatTimestamp, personName } from '@/lib/document-profile'
import type { DocumentStatusAccess, VoidDocumentAccess, getDocument } from '@/lib/documents'

type DocumentDetail = NonNullable<Awaited<ReturnType<typeof getDocument>>>

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? 'space-y-0.5'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

type StatusOption = { id: string; code: string; label: string | null }

type Props = {
  document: DocumentDetail
  project: { project_code: string; name: string } | null
  ctr: { code: string; description: string | null } | null
  nameById: ReadonlyMap<string, string | null>
  cpyField: CpyFieldMode
  /** scl_revision of the current revision, for the "Current revision" line under Additional attributes. */
  currentRevisionLabel: string | null
  documentStatus: { access: DocumentStatusAccess; currentStatusId: string; currentStatusLabel: string; options: StatusOption[] }
  voidAccess: VoidDocumentAccess
}

export default function DocumentInformationTab({
  document,
  project,
  ctr,
  nameById,
  cpyField,
  currentRevisionLabel,
  documentStatus,
  voidAccess,
}: Props) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Field label="Title" className="space-y-0.5 sm:col-span-2">
          {document.title}
        </Field>
        <Field label="SCL number">
          <span className="font-mono text-[13px]">{document.scl_doc_number}</span>
        </Field>
        <Field label="Client (CPY) number">
          {/* key: remount on a saved change, so the draft restarts from the stored value. */}
          <CpyNumberField
            key={document.cpy_doc_number ?? ''}
            documentId={document.id}
            value={document.cpy_doc_number}
            field={cpyField}
          />
        </Field>
        <Field label="Project">{project ? `${project.project_code} — ${project.name}` : '—'}</Field>
        <Field label="Document type">{dictionaryLabel(document.doc_type)}</Field>
        <Field label="Discipline">{dictionaryLabel(document.discipline)}</Field>
        <Field label="Area">{dictionaryLabel(document.area)}</Field>
        <Field label="Language">{dictionaryLabel(document.language)}</Field>
        <Field label="CTR code">{ctr ? (ctr.description ? `${ctr.code} — ${ctr.description}` : ctr.code) : '—'}</Field>
        <Field label="Budget hours">{document.budget_hours ?? '—'}</Field>
        <Field label="Originator">{personName(document.originator_id, nameById)}</Field>
        <Field label="Checker">{personName(document.checker_id, nameById)}</Field>
        <Field label="Approver">{personName(document.approver_id, nameById)}</Field>
      </dl>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Field label="Workflow status">
            <DocumentStatusControl
              documentId={document.id}
              currentStatusId={documentStatus.currentStatusId}
              currentStatusLabel={documentStatus.currentStatusLabel}
              access={documentStatus.access}
              options={documentStatus.options}
            />
          </Field>
          {voidAccess.mode === 'enabled' ? (
            <VoidDocumentDialog documentId={document.id} documentNumber={document.scl_doc_number} />
          ) : (
            <div className="space-y-1 text-right">
              <span title={voidAccess.hint}>
                <Button type="button" variant="outline" disabled aria-describedby="void-action-hint">
                  Void document
                </Button>
              </span>
              <p id="void-action-hint" className="max-w-[16rem] text-xs text-muted-foreground">
                {voidAccess.hint}
              </p>
            </div>
          )}
        </div>
        {document.void_reason ? (
          <Field label="Void reason" className="space-y-0.5">
            {document.void_reason}
            {document.void_at ? <span className="text-muted-foreground"> — {formatTimestamp(document.void_at)}</span> : null}
          </Field>
        ) : null}
      </div>

      <details className="group rounded-lg border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium marker:text-muted-foreground">
          Additional attributes
        </summary>
        <dl className="grid gap-4 border-t p-4 sm:grid-cols-2">
          <Field label="Current revision">{currentRevisionLabel ?? 'None yet'}</Field>
          <Field label="Created">{formatTimestamp(document.created_at)}</Field>
          <Field label="Last updated">{formatTimestamp(document.updated_at)}</Field>
          <Field label="Document ID" className="space-y-0.5 sm:col-span-2">
            <span className="font-mono text-xs text-muted-foreground">{document.id}</span>
          </Field>
        </dl>
      </details>
    </div>
  )
}
