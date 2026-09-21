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
// The bytes are never read here. The File the input handed over is given to the
// request as the body itself, so the browser streams it from disk; only its
// name, size and type (metadata, no content) are looked at. The PUT is an
// XMLHttpRequest rather than fetch for one reason — `upload.onprogress`, which
// fetch does not have — to the same signed URL, with the same two headers the
// URL requires (content-type, x-upsert: false). Nothing else changed: no TUS,
// no resumable protocol, the server actions and the policies are as they were.
//
// Rendered twice: in the current-revision panel (for the current revision) and
// in each expanded row of the Revisions tab (for that row's revision). Both
// finish the same way: the dialog closes and the page tree is refreshed, so
// the new row appears in the list — that refreshed list is what "done" means
// (hooks/use-pending-action.ts; e2e:pending measures it). From the click until
// then the submit button is disabled and reads "Adding…" (`pending`), and a
// second click in that window is refused by the hook's latch (lib/single-flight.ts)
// before the DOM has even committed `disabled` — e2e:files proves a double click
// stores exactly one object and one row.
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
import { FILE_KIND_LABELS, FILE_KINDS, mapUploadHttpError, uploadNetworkError, type FileKind, type FileResult } from '@/lib/files'
import { formatFileSize } from '@/lib/document-profile'

export type AddFileDialogProps = {
  revisionId: string
  /** "A", "00" — for the title. */
  revisionLabel: string
  documentNumber: string
  /** Panel: a full-width primary button. Row: a small outline button. */
  variant?: 'panel' | 'row'
}

/**
 * PUTs `file` to the signed upload URL and reports progress as a whole percent.
 * Resolves with the HTTP answer, or with null when there was none (a dropped
 * connection, an abort, a timeout) — it never rejects, so the caller always
 * gets a FileResult and the pending state always clears.
 */
function putToSignedUrl(
  url: string,
  file: File,
  mimeType: string,
  onProgress: (percent: number) => void,
): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', mimeType)
    // No upsert: an object is never overwritten (there is no UPDATE policy either).
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.floor((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
    xhr.onerror = () => resolve(null)
    xhr.onabort = () => resolve(null)
    xhr.ontimeout = () => resolve(null)
    xhr.send(file)
  })
}

export default function AddFileDialog({ revisionId, revisionLabel, documentNumber, variant = 'row' }: AddFileDialogProps) {
  const { run, refresh, pending } = usePendingAction()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileKind, setFileKind] = useState<FileKind>('original')
  const [error, setError] = useState<string | null>(null)
  // null: no bar (nothing has been sent yet, or the last attempt was refused). 0–100 while the
  // bytes go out and, at 100, while the row is written and the tree refreshed.
  const [progress, setProgress] = useState<number | null>(null)
  // A new key remounts the <input type=file> when the dialog reopens: a file input cannot be cleared by value.
  const [inputKey, setInputKey] = useState(0)

  const reset = () => {
    setFile(null)
    setFileKind('original')
    setError(null)
    setProgress(null)
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
      // Straight to Storage, with the token the server signed into the URL.
      setProgress(0)
      const response = await putToSignedUrl(prepared.data.signedUrl, chosen, mimeType ?? 'application/octet-stream', setProgress)
      if (!response) return uploadNetworkError()
      if (response.status < 200 || response.status >= 300) return mapUploadHttpError(response.status, response.body)
      setProgress(100)
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
      // The bar gives way to the sentence.
      setProgress(null)
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

          {progress !== null ? (
            <div className="space-y-1">
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                data-upload-progress={progress}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{progress < 100 ? `Uploading… ${progress}%` : 'Uploaded 100% — saving the file…'}</p>
            </div>
          ) : null}

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
