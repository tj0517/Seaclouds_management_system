'use client'

// DCS 1b.11: Void a document — a confirmation dialog with a mandatory reason,
// same Dialog component as New Revision (no new dependency; the task's own
// wording, "osobna akcja z potwierdzeniem i obowiązkowym powodem", is exactly
// what this is). The reason is required client-side too, so the reader is
// told before the round trip rather than only by the trigger's 23514.
//
// Irreversible in ordinary use: enforce_document_void() (migration
// 20260922074250) lets only an admin move a document back off Void, and this
// dialog does not pretend otherwise — the confirmation sentence says so.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { voidDocument } from '@/app/data/actions/documents'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'

export default function VoidDocumentDialog({ documentId, documentNumber }: { documentId: string; documentNumber: string }) {
  const { run, refresh, pending } = usePendingAction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Same pattern as AddFileDialog (1b.09) / NewRevisionDialog (1b.08b): stay open, on "Voiding…",
  // until the refreshed tree — document shown as Void — has committed.
  const [closeWhenRefreshed, setCloseWhenRefreshed] = useState(false)
  const shown = open && !(closeWhenRefreshed && !pending)

  const reasonValid = reason.trim() !== ''

  const submit = async () => {
    setError(null)
    if (!reasonValid) {
      setError('A reason is required to Void a document.')
      return
    }
    const result = await run(() => voidDocument({ documentId, reason }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setCloseWhenRefreshed(true)
    refresh()
  }

  return (
    <Dialog
      open={shown}
      onOpenChange={(next) => {
        if (!next && pending) return
        setOpen(next)
        if (next) {
          setReason('')
          setError(null)
          setCloseWhenRefreshed(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="border-destructive text-destructive hover:bg-destructive/10">
          Void document
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void document</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{documentNumber}</span> takes no further revisions once Void. This is irreversible in ordinary
            use — only an admin can move it off Void. Its number does not return to the pool.
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
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              rows={3}
              required
              value={reason}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
            />
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
            <Button type="submit" variant="destructive" disabled={pending || !reasonValid}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Voiding…' : 'Void document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
