'use client'

// DCS 1b.11: manual status change, Phase 1's stand-in for the workflow engine
// (brief §7.3: only the DC changes status in the MDR). An inline select, same
// shape as CpyNumberField: editable for the reader documentStatusAccess()
// says may write, plain text with a hint for everyone else.
//
// VOID is never offered here — see the section comment in lib/documents.ts.
// Voiding is VoidDocumentDialog, a separate, deliberately harder action with
// a mandatory reason.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { Button } from '@/components/ui/button'
import { setDocumentStatus } from '@/app/data/actions/documents'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import type { DocumentStatusAccess } from '@/lib/documents'
import { dictionaryLabel } from '@/lib/document-profile'

type Option = { id: string; code: string; label: string | null }

type Props = {
  documentId: string
  currentStatusId: string
  currentStatusLabel: string
  access: DocumentStatusAccess
  options: Option[]
}

export default function DocumentStatusControl({ documentId, currentStatusId, currentStatusLabel, access, options }: Props) {
  const { run, refresh, pending } = usePendingAction()
  const [draft, setDraft] = useState(currentStatusId)
  const [error, setError] = useState<string | null>(null)

  if (access.mode !== 'enabled') {
    return (
      <div className="space-y-1">
        <p className="text-sm">{currentStatusLabel}</p>
        <p className="text-xs text-muted-foreground">{access.hint}</p>
      </div>
    )
  }

  // The dropdown offers the option list plus, when the document is not
  // currently one of them (e.g. it just left Void, or a future dictionary
  // code the app has not caught up with), the current value too — so the
  // control never silently proposes changing something it is not showing.
  const selectable = options.some((option) => option.id === currentStatusId)
    ? options
    : [{ id: currentStatusId, code: currentStatusLabel, label: null }, ...options]

  const dirty = draft !== currentStatusId
  const draftOption = options.find((option) => option.id === draft)

  const save = async () => {
    if (!dirty || !draftOption) return
    setError(null)
    const result = await run(() => setDocumentStatus({ documentId, statusCode: draftOption.code }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    refresh()
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Workflow status"
          className={`h-8 min-w-0 max-w-full flex-1 sm:max-w-xs ${SELECT_CLASS}`}
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
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {pending ? 'Updating…' : 'Change status'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Manual — in Phase 2 the workflow engine will set this from the approval flow.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
