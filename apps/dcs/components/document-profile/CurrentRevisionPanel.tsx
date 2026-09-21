// DCS 1b.07 / 1b.08 / 1b.09: the right-hand panel — the document's current revision
// and its files, each with a Download button, and the Add File action for it.
//
// Built against the schema, not against dev data: on scl-dev every
// current_revision_id is NULL (read 2026-09-19), so the populated branch is
// proven on a local fixture (supabase/fixtures/document_profile.sql)
// and the empty branch is the one real documents show today.
//
// No signed URL anywhere in here: the file rows are metadata, and the URL is
// minted on click by the downloadFile action (DownloadFileButton, 1b.09).
import { EmptyState } from '@/components/page-chrome'
import RevisionPanelActions, { type AddFileControl, type NewRevisionControl } from './RevisionPanelActions'
import { mdrStatusColor } from '@/lib/mdr'
import RevisionFileList from './RevisionFileList'
import { dictionaryLabel, toFileRows } from '@/lib/document-profile'
import type { getRevisionWithFiles } from '@/lib/documents'
import { cn } from '@/lib/utils'

type RevisionWithFiles = NonNullable<Awaited<ReturnType<typeof getRevisionWithFiles>>>

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

export default function CurrentRevisionPanel({
  current,
  newRevision,
  addFile,
}: {
  current: RevisionWithFiles | null
  newRevision: NewRevisionControl
  addFile: AddFileControl
}) {
  return (
    <aside aria-label="Current revision" className="space-y-5 rounded-lg border bg-card p-4">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Current revision</h2>
        {current ? <RevisionDetails current={current} /> : <NoRevision />}
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-semibold">Actions</h2>
        <RevisionPanelActions newRevision={newRevision} addFile={addFile} />
      </section>
    </aside>
  )
}

function NoRevision() {
  return (
    <EmptyState title="No revision yet">
      This document has been registered and numbered, but nothing has been issued. Use New Revision below to issue the
      first one; files are added to a revision.
    </EmptyState>
  )
}

function RevisionDetails({ current }: { current: RevisionWithFiles }) {
  const { revision, files } = current
  return (
    <>
      <dl className="divide-y">
        <Row label="SCL revision">{revision.scl_revision}</Row>
        <Row label="CPY revision">{revision.cpy_revision ?? '—'}</Row>
        <Row label="Step">{dictionaryLabel(revision.step)}</Row>
        <Row label="Status">
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
              mdrStatusColor(revision.status?.code),
            )}
          >
            {dictionaryLabel(revision.status)}
          </span>
        </Row>
        <Row label="Revision date">{revision.revision_date ?? '—'}</Row>
        <Row label="Reason for issue">{revision.reason_for_issue ?? '—'}</Row>
      </dl>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Files ({files.length})</h3>
        <RevisionFileList files={toFileRows(files)} />
      </div>
    </>
  )
}
