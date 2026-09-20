'use client'

// DCS 1b.07: the CPY number on the document profile — an inline editor for the
// project's Document Controller, plain text for everyone else.
//
// Which of the two the reader gets is decided by cpyFieldMode() on the server
// and arrives here as `field`. That decision only MIRRORS the database (see its
// comment): the write goes through the setCpyNumber server action, whose
// authorization is the trigger documents_numbering_dc_only and RLS, so a stale
// or forged `field` can at worst show an editor that is then refused.
//
// Remounted by its parent (key = stored value) whenever the saved number
// changes, so `draft` never has to be re-synchronised in an effect.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setCpyNumber } from '@/app/data/actions/documents'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { cpyFieldHint, type CpyFieldMode } from '@/lib/document-profile'

type Props = {
  documentId: string
  /** The stored cpy_doc_number. */
  value: string | null
  field: CpyFieldMode
}

export default function CpyNumberField({ documentId, value, field }: Props) {
  const { run, refresh, pending } = usePendingAction()
  const [draft, setDraft] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)

  const hint = cpyFieldHint(field)

  if (field.mode !== 'editable') {
    return (
      <div className="space-y-1">
        <p className="text-sm">{value ?? '—'}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    )
  }

  const dirty = draft.trim() !== (value ?? '')

  const save = async () => {
    if (!dirty) return
    setError(null)
    const result = await run(() => setCpyNumber({ documentId, cpyNumber: draft }))
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
      <div className="flex items-center gap-2">
        <Input
          aria-label="Client (CPY) number"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={pending}
          placeholder="Not assigned"
          className="h-8 max-w-xs"
        />
        <Button type="submit" size="sm" disabled={!dirty || pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Leave empty and save to clear the number.</p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
