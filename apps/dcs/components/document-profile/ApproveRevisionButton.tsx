'use client'

// DCS 1b.11: Approve — sets dcs.revisions.locked_at on the current revision.
// A confirmation dialog, not a plain button: locked_at is never cleared, for
// anyone (migration 20260921150000), so this is the one action on the panel
// with no undo, and the dialog says so before the click that cannot be taken
// back.
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
import { lockRevision } from '@/app/data/actions/revisions'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'

export default function ApproveRevisionButton({
  documentId,
  revisionId,
  revisionLabel,
}: {
  documentId: string
  revisionId: string
  revisionLabel: string
}) {
  const { run, refresh, pending } = usePendingAction()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Same pattern as AddFileDialog (1b.09) / NewRevisionDialog (1b.08b): stay open, on
  // "Approving…", until the refreshed tree — the Approved badge, files gated — has committed.
  const [closeWhenRefreshed, setCloseWhenRefreshed] = useState(false)
  const shown = open && !(closeWhenRefreshed && !pending)

  const submit = async () => {
    setError(null)
    const result = await run(() => lockRevision({ revisionId, documentId }))
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
          setError(null)
          setCloseWhenRefreshed(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full">
          Approve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve revision {revisionLabel}</DialogTitle>
          <DialogDescription>
            The revision and its files become immutable. This cannot be undone — to correct it later, add a new revision.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {pending ? 'Approving…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
