// DCS 1b.07: the right-hand panel — the document's current revision and its
// files, read-only.
//
// Built against the schema, not against dev data: on scl-dev every
// current_revision_id is NULL (read 2026-09-19), so the populated branch is
// proven on a local fixture (supabase/fixtures/document_profile.sql)
// and the empty branch is the one real documents show today.
//
// No download link and no signed URL anywhere in here: the file rows are
// metadata only. Turning storage_path into something a person can open is
// 1b.09.
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/page-chrome'
import RevisionPanelActions from './RevisionPanelActions'
import { mdrStatusColor } from '@/lib/mdr'
import { dictionaryLabel, fileDisplayName, formatFileSize, formatTimestamp } from '@/lib/document-profile'
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

export default function CurrentRevisionPanel({ current }: { current: RevisionWithFiles | null }) {
  return (
    <aside aria-label="Current revision" className="space-y-5 rounded-lg border bg-card p-4">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Current revision</h2>
        {current ? <RevisionDetails current={current} /> : <NoRevision />}
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-semibold">Actions</h2>
        <RevisionPanelActions />
      </section>
    </aside>
  )
}

function NoRevision() {
  return (
    <EmptyState title="No revision yet">
      This document has been registered and numbered, but nothing has been issued. Revisions and files arrive with DCS
      1b.08 and 1b.09.
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
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files on this revision.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {files.map((file) => (
              <li key={file.id} className="space-y-1 px-3 py-2">
                <p className="break-all text-sm font-medium">{fileDisplayName(file)}</p>
                {/* A <div>, not a <p>: Badge renders a <div>, and a <div> inside a <p> is invalid
                    HTML that React reports as a hydration error. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
                    {file.file_kind}
                  </Badge>
                  <span>{formatFileSize(file.size_bytes)}</span>
                  <span>{formatTimestamp(file.uploaded_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
