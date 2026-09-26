// DCS 1b.08 / 1b.09: one revision's files — shared by the current-revision
// panel (1b.07) and each expanded row of the Revisions tab, so the two cannot
// drift. Each row lists the generated name, the uploaded name as a hint, the
// kind, the size and the upload time, and carries a Download button (1b.09).
// No link and no signed URL are ever rendered: the URL is minted on click, as
// the signed-in user, by the downloadFile action (DownloadFileButton).
//
// DCS 1b.23: the current-revision panel is a `compact` render — name and
// Download only. Size, kind, upload time and the "Uploaded as" hint stay in
// the Revisions tab (the default render), which is the one place a reader
// goes for a file's full metadata.
//
// No hooks and no 'use client' here: it is markup, usable from a server
// component and from the client table alike; the button is its own client
// component.
import { Badge } from '@/components/ui/badge'
import type { FileRowView } from '@/lib/document-profile'
import DownloadFileButton from './DownloadFileButton'

export default function RevisionFileList({ files, compact = false }: { files: readonly FileRowView[]; compact?: boolean }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No files on this revision.</p>
  }
  return (
    <ul className="divide-y rounded-md border bg-card">
      {files.map((file) => (
        <li key={file.id} data-file-row={file.name} className="flex items-start justify-between gap-3 px-3 py-2">
          <div className="min-w-0 space-y-1">
            <p className="break-all text-sm font-medium">{file.name}</p>
            {compact ? null : (
              <>
                {/* ONE text node, on purpose: `Uploaded as {name}` would be two adjacent text nodes with a
                    comment between them, and that measurably raised an intermittent hydration error on the
                    profile (docs/deferred-tasks.md, ccc: ~13 of 100 loads with two nodes, ~3 of 100 with one). */}
                {file.originalName ? <p className="break-all text-xs text-muted-foreground">{`Uploaded as ${file.originalName}`}</p> : null}
                {/* A <div>, not a <p>: Badge renders a <div>, and a <div> inside a <p> is invalid
                    HTML that React reports as a hydration error. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
                    {file.kind}
                  </Badge>
                  <span>{file.size}</span>
                  <span>{file.uploaded}</span>
                </div>
              </>
            )}
          </div>
          <DownloadFileButton fileId={file.id} fileName={file.name} />
        </li>
      ))}
    </ul>
  )
}
