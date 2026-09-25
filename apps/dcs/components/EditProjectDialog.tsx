'use client'

// DCS 1a.17 → 1b.19: the DCS-side project edit dialog. Originally covered
// both halves of a project's configuration (decision O-13: identity in
// public.projects, DCS configuration in dcs.mdr_settings); since 1b.19 it
// edits dcs.mdr_settings only — client agreement 2026-09-25 made name /
// client / process type / year read-only in DCS for everyone, admin
// included, until the admin portal (ADR-0014) exists to edit them (until
// then O-20). They are shown here for context, disabled, with a note saying
// where they actually get changed. This dialog is only rendered at all when
// settings is non-null (app/(app)/admin/projects/[projectId]/page.tsx) —
// with nothing left to edit once identity is read-only, "DCS does not run
// this project" is no longer a state this dialog needs to handle.
//
// Open to the project's DC as well as an admin since 1b.19 (requireAdminOrDc
// in lib/project-mdr.ts's updateProjectMdr) — previously admin-only.
//
// *** AUDITED (since 1a.17b) ***
// Every field in this dialog leaves a trail in public.audit_log — one row per
// column that actually changed, with the editor's user_id and IP.
// migration 20260916145603_audit_mdr_settings. That table has no `uuid id` —
// its PK is project_id — so audit_trigger() resolves record_id by row shape
// (`coalesce(id, project_id)`) and the cycle entries key on the project.
// It matters here because brief §5.2 makes the cycle an attribute documents
// inherit and Phase 2 computes Planned dates from it: "who shortened the
// cycle from 10 days to 3" is answerable from audit_log, not guesswork off
// mdr_settings.updated_at.
import { useState, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { updateProjectMdr } from '@/app/data/actions/project-mdr'
import {
  MDR_STATUSES,
  MDR_STATUS_LABELS,
  PROCESS_TYPE_LABELS,
  skipsClientStep,
  type MdrSettingsRow,
  type MdrStatus,
  type ProjectRow,
} from '@/lib/project-mdr'

type ClientOption = { id: string; name: string; code: string }

type Props = {
  project: ProjectRow
  /** Always present — the caller only renders this dialog once DCS runs the project. */
  settings: MdrSettingsRow
  clients: ClientOption[]
  trigger: ReactNode
}

export default function EditProjectDialog({ project, settings, clients, trigger }: Props) {
  // DCS 1a.24: pending holds through router.refresh(), so the dialog does not
  // close onto a summary that still shows the old cycle.
  const { run, refresh, pending } = usePendingAction()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cpyNumbering, setCpyNumbering] = useState(settings.cpy_numbering)
  const [cycleIdcToIfr, setCycleIdcToIfr] = useState(String(settings.cycle_idc_to_ifr))
  const [cycleIfrToRetcom, setCycleIfrToRetcom] = useState(String(settings.cycle_ifr_to_retcom))
  const [cycleRetcomToIfc, setCycleRetcomToIfc] = useState(String(settings.cycle_retcom_to_ifc))
  const [budgetHours, setBudgetHours] = useState(settings.budget_hours === null ? '' : String(settings.budget_hours))
  const [status, setStatus] = useState<MdrStatus>(settings.status)

  const reset = () => {
    setCpyNumbering(settings.cpy_numbering)
    setCycleIdcToIfr(String(settings.cycle_idc_to_ifr))
    setCycleIfrToRetcom(String(settings.cycle_ifr_to_retcom))
    setCycleRetcomToIfc(String(settings.cycle_retcom_to_ifc))
    setBudgetHours(settings.budget_hours === null ? '' : String(settings.budget_hours))
    setStatus(settings.status)
    setError(null)
  }

  // Shared with Timesheet, read-only here (client agreement 2026-09-25) —
  // same invariant dcs_enable_project_mdr enforces on creation: CPY numbering
  // needs a client, and an internal project has none at all.
  const internal = project.process_type !== null && skipsClientStep(project.process_type)
  const hasClient = project.client_id !== null
  const cpyDisabled = internal || !hasClient
  const cpyHint = internal
    ? 'An internal project has no client.'
    : !hasClient
      ? 'This project has no client, so it cannot use CPY numbering.'
      : null
  const client = clients.find((c) => c.id === project.client_id)

  const handleSubmit = async () => {
    setError(null)

    const result = await run(() =>
      updateProjectMdr({
        projectId: project.id,
        // Sent as-is, not forced to false while disabled: the checkbox is
        // non-interactive in that state, so cpyNumbering already equals
        // settings.cpy_numbering and this is a no-op in the diff. Forcing it
        // would silently flip off an existing (inconsistent, pre-existing)
        // true value as a side effect of saving an unrelated field.
        cpyNumbering,
        cycleIdcToIfr: Number(cycleIdcToIfr),
        cycleIfrToRetcom: Number(cycleIfrToRetcom),
        cycleRetcomToIfc: Number(cycleRetcomToIfc),
        budgetHours: budgetHours.trim() === '' ? null : Number(budgetHours),
        status,
      }),
    )

    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ? `${result.error}: ${result.message}` : result.error)
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit DCS settings</DialogTitle>
          <DialogDescription>Only the fields you actually change are written.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label htmlFor="edit-project-name">Name</Label>
            <Input id="edit-project-name" value={project.name} readOnly disabled />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-project-code">Project code</Label>
            <Input id="edit-project-code" value={project.project_code} readOnly disabled />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-process-type">Process type</Label>
              <Input
                id="edit-process-type"
                value={project.process_type ? PROCESS_TYPE_LABELS[project.process_type] : 'Not classified'}
                readOnly
                disabled
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-year">Year</Label>
              <Input id="edit-year" value={project.year === null ? '—' : String(project.year)} readOnly disabled />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-client">Client</Label>
            <Input id="edit-client" value={client ? `${client.code} — ${client.name}` : 'No client'} readOnly disabled />
          </div>

          <p className="text-xs text-muted-foreground">
            Name, project code, process type, year and client are Timesheet&apos;s and read-only here — Timesheet
            is where they are changed.
          </p>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring"
              checked={cpyNumbering}
              disabled={cpyDisabled}
              onChange={(e) => setCpyNumbering(e.target.checked)}
            />
            CPY numbering
          </label>
          {cpyHint && <p className="text-xs text-muted-foreground">{cpyHint}</p>}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-cycle-idc">IDC → IFR</Label>
              <Input id="edit-cycle-idc" inputMode="numeric" value={cycleIdcToIfr} onChange={(e) => setCycleIdcToIfr(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-cycle-ifr">IFR → RETCOM</Label>
              <Input id="edit-cycle-ifr" inputMode="numeric" value={cycleIfrToRetcom} onChange={(e) => setCycleIfrToRetcom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-cycle-retcom">RETCOM → IFC</Label>
              <Input id="edit-cycle-retcom" inputMode="numeric" value={cycleRetcomToIfc} onChange={(e) => setCycleRetcomToIfc(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Changing a cycle does not move dates on documents that already exist — that is Phase 2.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-budget">Budget hours</Label>
              <Input
                id="edit-budget"
                inputMode="decimal"
                value={budgetHours}
                onChange={(e) => setBudgetHours(e.target.value)}
                placeholder="no budget"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-status">MDR status</Label>
              <select
                id="edit-status"
                className={`w-full ${SELECT_CLASS}`}
                value={status}
                onChange={(e) => setStatus(e.target.value as MdrStatus)}
              >
                {MDR_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {MDR_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Documentation open or closed — not the same as Timesheet&apos;s active flag.</p>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">Error: {error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
