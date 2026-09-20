// DCS 1b.08: one revision's files, read-only — shared by the current-revision
// panel (1b.07) and each expanded row of the Revisions tab, so the two cannot
// drift. No download link and no signed URL: the rows are metadata only, and
// turning a storage_path into something a person can open is 1b.09. Today every
// list is empty (nothing uploads files yet), and the empty sentence says so.
//
// No hooks and no 'use client': it is markup, usable from a server component and
// from the client table alike.
import { Badge } from '@/components/ui/badge'
import type { FileRowView } from '@/lib/document-profile'

export default function RevisionFileList({ files }: { files: readonly FileRowView[] }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No files on this revision.</p>
  }
  return (
    <ul className="divide-y rounded-md border bg-card">
      {files.map((file) => (
        <li key={file.id} className="space-y-1 px-3 py-2">
          <p className="break-all text-sm font-medium">{file.name}</p>
          {/* A <div>, not a <p>: Badge renders a <div>, and a <div> inside a <p> is invalid
              HTML that React reports as a hydration error. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
              {file.kind}
            </Badge>
            <span>{file.size}</span>
            <span>{file.uploaded}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
