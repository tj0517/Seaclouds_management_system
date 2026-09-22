'use client'

// DCS 1b.11 (Scope item 4): manual status change on the CURRENT revision —
// the same inline-select pattern as DocumentStatusControl, scoped to
// dcs.revisions.status_id instead of dcs.documents.workflow_status_id.
//
// DC only, no admin escape (revisionStatusAccess() says so; the real guard is
// revisions_status_dc_only). RevisionDetails (CurrentRevisionPanel.tsx) shows
// the read-only status badge every reader gets and mounts this component only
// when access.mode is 'enabled' — a reader who is not the project's DC, or
// who is but not at aal2, or whose revision is locked, never sees a select
// here at all; RevisionDetails prints the matching hint sentence next to the
// badge instead (or nothing, for a reader who could never act — Scope item 4
// / the "non-DC sees no controls" acceptance check).
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { Button } from '@/components/ui/button'
import { setRevisionStatus } from '@/app/data/actions/revisions'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { dictionaryLabel } from '@/lib/document-profile'

type Option = { id: string; code: string; label: string | null }

type Props = {
  documentId: string
  revisionId: string
  currentStatusId: string
  currentStatusLabel: string
  options: Option[]
}

export default function RevisionStatusControl({ documentId, revisionId, currentStatusId, currentStatusLabel, options }: Props) {
  const { run, refresh, pending } = usePendingAction()
  const [draft, setDraft] = useState(currentStatusId)
  const [error, setError] = useState<string | null>(null)

  const selectable = options.some((option) => option.id === currentStatusId)
    ? options
    : [{ id: currentStatusId, code: currentStatusLabel, label: null }, ...options]

  const dirty = draft !== currentStatusId
  const draftOption = options.find((option) => option.id === draft)

  const save = async () => {
    if (!dirty || !draftOption) return
    setError(null)
    const result = await run(() => setRevisionStatus({ revisionId, documentId, statusCode: draftOption.code }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    refresh()
  }

  return (
    <form
      className="space-y-1"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          aria-label="Revision status"
          className={`h-7 min-w-0 max-w-[10rem] ${SELECT_CLASS}`}
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
        >
          {selectable.map((option) => (
            <option key={option.id} value={option.id}>
              {dictionaryLabel(option)}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={!dirty || pending}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {pending ? 'Updating…' : 'Update'}
        </Button>
      </div>
      <p className="text-right text-xs text-muted-foreground">Manual</p>
      {error ? (
        <p role="alert" className="text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
