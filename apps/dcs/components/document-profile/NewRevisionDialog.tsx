'use client'

// DCS 1b.08: the New Revision dialog — step, SCL revision, CPY revision,
// revision date, reason for issue and an optional client acceptance code. No
// comment field: dcs.revisions has no such column, and revision comments are
// Phase 2's data model (DCS 2.09).
//
// WHAT THE SCREEN DECIDES, AND WHAT IT DOES NOT. The code is the database's. On
// open, and again whenever the step changes, the dialog asks the server for the
// proposal (dcs.next_revision_code, through the proposeRevisionCode action) and
// shows it. For an Originator that is read-only text: leaving scl_revision out of
// the insert is what makes the database assign it, and the number that is stored
// is computed again inside the insert, so two people pressing Create together can
// both have seen "B" and get B and C. For the project's Document Controller in an
// aal2 session the field is editable, and the value is sent ONLY when they
// changed it — an untouched proposal is left to the generator instead of being
// posted back, which would turn a stale proposal into a hand-typed code.
//
// Who may do what is decided by the database (RLS, and the triggers named in
// lib/revisions.ts); newRevisionAccess() and sclCodeField() only mirror it to
// decide what is offered.
//
// After saving, the dialog closes and the page navigates to the Revisions tab
// with the new row expanded (`?tab=revisions&open=<id>`) — the tab is a query
// parameter because this dialog lives in the panel beside the tabs.
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createRevision, proposeRevisionCode } from '@/app/data/actions/revisions'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { isValidDateString, todayLocalIso, type RevisionResult, type SclCodeField } from '@/lib/revisions'

type Option = { id: string; code: string; label: string }

export type NewRevisionFormConfig = {
  documentId: string
  documentNumber: string
  /** Only the steps that have an SCL series — see revisionStepOptions. */
  steps: Option[]
  acceptanceCodes: Option[]
  defaultStepId: string
  scl: SclCodeField
  /** editable: the DC of a project that runs a CPY track. hidden: everyone else — with a sentence when the project does run one. */
  cpy: { mode: 'editable' } | { mode: 'hidden'; hint: string | null }
}

type Proposal = { stepId: string; result: RevisionResult<{ code: string }> }

const optionLabel = (option: Option) => (option.label && option.label !== option.code ? `${option.code} — ${option.label}` : option.code)

export default function NewRevisionDialog({ config }: { config: NewRevisionFormConfig }) {
  const { documentId, documentNumber, steps, acceptanceCodes, scl, cpy } = config
  const router = useRouter()
  const { run, pending: actionPending } = usePendingAction()
  const [navigating, startNavigation] = useTransition()

  const [open, setOpen] = useState(false)
  const [stepId, setStepId] = useState(config.defaultStepId)
  // null = the DC has not touched the field, so it follows the proposal.
  const [sclOverride, setSclOverride] = useState<string | null>(null)
  const [cpyRevision, setCpyRevision] = useState('')
  const [revisionDate, setRevisionDate] = useState('')
  const [reason, setReason] = useState('')
  const [acceptanceCodeId, setAcceptanceCodeId] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = actionPending || navigating

  // The proposal for the step on screen. Async results only touch state after the
  // await, and a result that arrives for a step the user has already left is
  // dropped — the request that answers the CURRENT step is the one that shows.
  useEffect(() => {
    if (!open || !stepId) return
    let stale = false
    void proposeRevisionCode({ documentId, stepId }).then((result) => {
      if (!stale) setProposal({ stepId, result })
    })
    return () => {
      stale = true
    }
  }, [open, stepId, documentId])

  const loading = proposal?.stepId !== stepId
  const proposedCode = proposal && proposal.stepId === stepId && proposal.result.ok ? proposal.result.data.code : null
  const proposalError = proposal && proposal.stepId === stepId && !proposal.result.ok ? (proposal.result.message ?? proposal.result.error) : null

  const reset = () => {
    setStepId(config.defaultStepId)
    setSclOverride(null)
    setCpyRevision('')
    setRevisionDate(todayLocalIso())
    setReason('')
    setAcceptanceCodeId('')
    setProposal(null)
    setError(null)
  }

  const dateValid = isValidDateString(revisionDate)

  const submit = async () => {
    setError(null)
    if (!dateValid) {
      setError('Enter the revision date.')
      return
    }
    // Sent only when the Document Controller changed the proposal (see the header).
    const typed = scl.mode === 'editable' && sclOverride !== null ? sclOverride.trim() : ''
    const sclRevision = typed !== '' && typed !== proposedCode ? typed : null

    const result = await run(() =>
      createRevision({
        documentId,
        stepId,
        sclRevision,
        cpyRevision: cpy.mode === 'editable' ? cpyRevision : null,
        revisionDate,
        reasonForIssue: reason,
        acceptanceCodeId: acceptanceCodeId === '' ? null : acceptanceCodeId,
      }),
    )
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setOpen(false)
    startNavigation(() => router.push(`/documents/${documentId}?tab=revisions&open=${result.data.id}`))
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
        <Button type="button" className="w-full">
          New Revision
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New revision</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{documentNumber}</span> — it becomes the document’s current revision, and the one before it is
            marked superseded.
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
            <Label htmlFor="revision-step">Step</Label>
            <select
              id="revision-step"
              className={`w-full ${SELECT_CLASS}`}
              value={stepId}
              disabled={pending}
              onChange={(event) => {
                setStepId(event.target.value)
                // A code typed for one series is meaningless in another.
                setSclOverride(null)
              }}
            >
              {steps.map((step) => (
                <option key={step.id} value={step.id}>
                  {optionLabel(step)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="revision-scl">SCL revision</Label>
            {scl.mode === 'editable' ? (
              <>
                <Input
                  id="revision-scl"
                  className="font-mono"
                  value={sclOverride ?? proposedCode ?? ''}
                  placeholder={loading ? '…' : ''}
                  disabled={pending}
                  onChange={(event) => setSclOverride(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Proposed by the system; as Document Controller you may choose another code of this step’s series.
                </p>
              </>
            ) : (
              <>
                <output
                  id="revision-scl"
                  data-testid="proposed-code"
                  aria-live="polite"
                  className="flex h-9 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm"
                >
                  {loading ? '…' : (proposedCode ?? '—')}
                </output>
                <p className="text-xs text-muted-foreground">{scl.hint}</p>
              </>
            )}
            {proposalError ? (
              <p role="status" className="text-xs text-destructive">
                {proposalError}
              </p>
            ) : null}
          </div>

          {cpy.mode === 'editable' ? (
            <div className="space-y-1">
              <Label htmlFor="revision-cpy">Client (CPY) revision</Label>
              <Input
                id="revision-cpy"
                value={cpyRevision}
                disabled={pending}
                placeholder="Optional — the client’s own revision marker"
                onChange={(event) => setCpyRevision(event.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="revision-date">Revision date</Label>
            <Input
              id="revision-date"
              type="date"
              required
              value={revisionDate}
              disabled={pending}
              onChange={(event) => setRevisionDate(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="revision-reason">Reason for issue</Label>
            <Textarea id="revision-reason" rows={2} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="revision-acceptance">Client acceptance code</Label>
            <select
              id="revision-acceptance"
              className={`w-full ${SELECT_CLASS}`}
              value={acceptanceCodeId}
              disabled={pending}
              onChange={(event) => setAcceptanceCodeId(event.target.value)}
            >
              <option value="">— none —</option>
              {acceptanceCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {optionLabel(code)}
                </option>
              ))}
            </select>
          </div>

          {cpy.mode === 'hidden' && cpy.hint ? <p className="text-xs text-muted-foreground">{cpy.hint}</p> : null}

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !dateValid || !stepId}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Creating…' : 'Create revision'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
