'use client'

// DCS 1b.09 (PR 2): the Add File dialog — a file, its kind, and the three steps
// of an upload: the server generates the name and signs an upload URL
// (prepareFileUpload), the browser PUTs the bytes straight to Storage, the
// server writes the dcs.files row (recordFileUpload). The generated name is
// the file's name; the user's own name is kept as original_name and shown as
// a hint, never used for the object key.
//
// Who may upload is decided by the bucket's INSERT policies and the dcs.files
// INSERT policies, evaluated as the signed-in user when the upload URL is
// signed and when the row is written. fileUploadAccess() only mirrors them to
// decide whether this dialog is offered; a wrong mirror can at worst offer a
// control that is then refused with a sentence.
//
// No size check in front of the upload on purpose: the bucket (100 MiB) and the
// project's global limit are enforced by the storage-api, and its refusal is
// shown as a sentence (mapUploadHttpError) — a check here would hide which
// limit refused the file.
//
// Rendered twice: in the current-revision panel (for the current revision) and
// in each expanded row of the Revisions tab (for that row's revision). Both
// finish the same way: the dialog closes and the page tree is refreshed, so
// the new row appears in the list — that refreshed list is what "done" means
// (hooks/use-pending-action.ts; e2e:pending measures it).
import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { prepareFileUpload, recordFileUpload } from '@/app/data/actions/files'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { FILE_KIND_LABELS, FILE_KINDS, mapUploadHttpError, type FileKind, type FileResult } from '@/lib/files'
import { formatFileSize } from '@/lib/document-profile'

export type AddFileDialogProps = {
  revisionId: string
  /** "A", "00" — for the title. */
  revisionLabel: string
  documentNumber: string
  /** Panel: a full-width primary button. Row: a small outline button. */
  variant?: 'panel' | 'row'
}

export default function AddFileDialog({ revisionId, revisionLabel, documentNumber, variant = 'row' }: AddFileDialogProps) {
  const { run, refresh, pending } = usePendingAction()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileKind, setFileKind] = useState<FileKind>('original')
  const [error, setError] = useState<string | null>(null)
  // A new key remounts the <input type=file> when the dialog reopens: a file input cannot be cleared by value.
  const [inputKey, setInputKey] = useState(0)

  const reset = () => {
    setFile(null)
    setFileKind('original')
    setError(null)
    setInputKey((key) => key + 1)
  }

  const submit = async () => {
    setError(null)
    if (!file) {
      setError('Choose a file.')
      return
    }
    const chosen = file
    const mimeType = chosen.type || null
    const result = await run<FileResult<{ id: string; documentId: string; fileName: string }>>(async () => {
      const prepared = await prepareFileUpload({ revisionId, fileKind, originalName: chosen.name })
      if (!prepared.ok) return prepared
      // Straight to Storage, with the token the server signed into the URL. No
      // upsert: an object is never overwritten (there is no UPDATE policy either).
      const response = await fetch(prepared.data.signedUrl, {
        method: 'PUT',
        headers: { 'content-type': mimeType ?? 'application/octet-stream', 'x-upsert': 'false' },
        body: chosen,
      })
      if (!response.ok) return mapUploadHttpError(response.status, await response.text().catch(() => ''))
      return recordFileUpload({
        revisionId,
        fileKind,
        originalName: chosen.name,
        fileName: prepared.data.fileName,
        storagePath: prepared.data.storagePath,
        sizeBytes: chosen.size,
        mimeType,
      })
    })
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setOpen(false)
    refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>
        {variant === 'panel' ? (
          <Button type="button" className="w-full" data-add-file={revisionLabel}>
            Add File
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" data-add-file={revisionLabel}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add File
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a file to revision {revisionLabel}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{documentNumber}</span> — the file is stored under a generated name (document number, revision, step,
            date, sequence number); your file’s own name is kept as a hint.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="add-file-input">File</Label>
            <input
              key={inputKey}
              id="add-file-input"
              type="file"
              required
              disabled={pending}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="text-xs text-muted-foreground">
                {file.name} · {formatFileSize(file.size)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="add-file-kind">Kind</Label>
            <select
              id="add-file-kind"
              className={`w-full ${SELECT_CLASS}`}
              value={fileKind}
              disabled={pending}
              onChange={(event) => setFileKind(event.target.value as FileKind)}
            >
              {FILE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {FILE_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Adding…' : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
