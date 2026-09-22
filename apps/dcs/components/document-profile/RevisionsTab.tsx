'use client'

// DCS 1b.08: the Revisions tab — every revision of the document, newest first,
// each row expandable to that revision's files.
//
// The rows are read-only: no edit, no delete. Each expanded row lists the
// revision's files with a Download button, and — for a reader the INSERT
// policies admit (fileUploadAccess mirrors them) — an Add File dialog for that
// revision (DCS 1b.09). The rows arrive as strings already (toRevisionRows in
// lib/revisions.ts, unit tested), so this component only draws them and keeps
// the one piece of state it owns: which rows are open.
//
// After New Revision saves, the dialog navigates here with `?tab=revisions&open=<id>`
// and `openId` is that revision — expanded on arrival. The parent gives this
// component a `key` that changes with it, so the initial state is re-read when
// the URL changes rather than being kept from the previous visit.
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/page-chrome'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { mdrStatusColor } from '@/lib/mdr'
import { fileUploadAccess, type FileUploadAccess } from '@/lib/files'
import type { RevisionRow } from '@/lib/revisions'
import { cn } from '@/lib/utils'
import AddFileDialog from './AddFileDialog'
import RevisionFileList from './RevisionFileList'

// Codes in the cells, "CODE — label" in the tooltip, and the columns that answer "what is this revision and
// where does it stand" first — SCL revision, Status, Step, Date, Author — because eight columns do not all fit
// beside the profile's right-hand panel on a laptop, and the wrapper scrolls sideways for the rest.
const COLUMNS = ['SCL revision', 'Status', 'Step', 'Date', 'Author', 'Reason for issue', 'CPY revision', 'Acceptance'] as const

/** The reader's role/assurance — the part of fileUploadAccess() that is the SAME for every row. */
export type UploadRole = { isAdmin: boolean; isOrig: boolean; isDc: boolean; aal2: boolean }

export default function RevisionsTab({
  rows,
  openId,
  documentNumber,
  uploadRole,
}: {
  rows: RevisionRow[]
  openId: string | null
  documentNumber: string
  /**
   * Whether this reader may add files, mirroring the INSERT policies — the role/aal2 part is the
   * same for every row, but locked_at (DCS 1b.10 Approve) is per revision, so each row computes its
   * own fileUploadAccess() from this plus row.isLocked, rather than sharing one answer.
   */
  uploadRole: UploadRole
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(openId && rows.some((row) => row.id === openId) ? [openId] : []))

  if (rows.length === 0) {
    return (
      <EmptyState title="No revision yet">
        This document has been registered and numbered, but nothing has been issued. Use New Revision in the panel on the right to
        issue the first one.
      </EmptyState>
    )
  }

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            {COLUMNS.map((column) => (
              <TableHead key={column} className="h-9 whitespace-nowrap px-1.5">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = open.has(row.id)
            const detailsId = `revision-${row.id}-files`
            return (
              <RevisionRowView
                key={row.id}
                row={row}
                expanded={expanded}
                detailsId={detailsId}
                onToggle={() => toggle(row.id)}
                documentNumber={documentNumber}
                upload={fileUploadAccess({ hasRevision: true, isLocked: row.isLocked, ...uploadRole })}
              />
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function RevisionRowView({
  row,
  expanded,
  detailsId,
  onToggle,
  documentNumber,
  upload,
}: {
  row: RevisionRow
  expanded: boolean
  detailsId: string
  onToggle: () => void
  documentNumber: string
  upload: FileUploadAccess
}) {
  return (
    <>
      <TableRow data-revision-row={row.sclRevision} data-current={row.isCurrent ? 'true' : undefined}>
        <TableCell className="whitespace-nowrap px-1.5 py-2 font-medium">
          {/* The button, not the row, is the control: a keyboard user and a screen reader get a real
              button with an expanded state, and the table keeps its plain row semantics. */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailsId}
            className="inline-flex items-center gap-1 rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
            <span className="font-mono text-sm">{row.sclRevision}</span>
            <span className="sr-only">— files</span>
          </button>
          {row.isCurrent ? (
            <span className="ml-5 mt-0.5 block w-fit rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0 text-[11px] font-medium text-blue-800">
              Current
            </span>
          ) : null}
        </TableCell>
        <TableCell className="px-1.5 py-2">
          <span
            title={row.statusLabel}
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
              mdrStatusColor(row.statusCode),
            )}
          >
            {row.statusCode ?? '—'}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap px-1.5 py-2" title={row.step}>
          {row.stepCode}
        </TableCell>
        <TableCell className="whitespace-nowrap px-1.5 py-2">{row.date}</TableCell>
        <TableCell className="px-1.5 py-2">{row.author}</TableCell>
        <TableCell className="min-w-24 px-1.5 py-2">{row.reason}</TableCell>
        <TableCell className="px-1.5 py-2">{row.cpyRevision}</TableCell>
        <TableCell className="whitespace-nowrap px-1.5 py-2" title={row.acceptanceCode}>
          {row.acceptanceCodeShort}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow id={detailsId} data-revision-files={row.sclRevision} className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={COLUMNS.length} className="space-y-2 px-2 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Files on revision {row.sclRevision} ({row.files.length})
              </h3>
              {upload.mode === 'enabled' ? (
                <AddFileDialog revisionId={row.id} revisionLabel={row.sclRevision} documentNumber={documentNumber} />
              ) : upload.reason !== 'no_revision' ? (
                <p className="text-xs text-muted-foreground">{upload.hint}</p>
              ) : null}
            </div>
            <RevisionFileList files={row.files} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
