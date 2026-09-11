'use client'

// DCS 1a.17: the DCS-side project edit dialog — the fields the Create Project
// MDR wizard sets, changeable afterwards. Mirrors ClientDialog (1a.16): one
// dialog, diff-only save through a server action, errors shown in place.
//
// The fields span the two tables a project's configuration is split between
// (decision O-13): name / client / process type / year live in
// public.projects, while cpy_numbering / the three cycle lengths /
// budget_hours / status live in dcs.mdr_settings. updateProjectMdr
// (lib/project-mdr.ts) diffs each table separately and issues no statement at
// all for a table whose fields did not change.
//
// *** AUDITING IS ASYMMETRIC, ON PURPOSE ***
// Changes to the public.projects half are recorded by the existing
// audit_trigger() (1a.08) — one public.audit_log row per column that actually
// changed. Changes to the dcs.mdr_settings half are NOT recorded anywhere:
// that table is deliberately outside audit_trigger()'s table list, because
// the function assumes a `uuid id` primary key and mdr_settings' PK is
// project_id (documented in 20260903173128_create_audit_log.sql and
// docs/02-data-model.md). So editing a review cycle or a budget here leaves
// no audit trail beyond mdr_settings.updated_at. Extending the trigger is
// task 1a.17b (docs/deferred-tasks.md) — deliberately not folded into this
// PR, which is why this comment exists rather than a quick fix.
//
// project_code is absent by design, not omission: it is the first segment of
// every document number in the project (SC2601-SCL-RA-0012-EN), so changing
// it would retroactively alter numbers already issued — the same argument
// that made dcs.dictionaries.code immutable in 1a.15b. Here it is enforced by
// the app only (UpdateProjectMdrInput has no such field, and
// parseUpdateProjectMdrInput drops one from a raw payload); the database
// still allows the UPDATE, exactly the gap 1a.15b closed for dictionaries.
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
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
import { updateProjectMdr } from '@/app/data/actions/project-mdr'
import {
  MDR_STATUSES,
  MDR_STATUS_LABELS,
  PROCESS_TYPES,
  PROCESS_TYPE_LABELS,
  skipsClientStep,
  type MdrSettingsRow,
  type MdrStatus,
  type ProcessType,
  type ProjectRow,
} from '@/lib/project-mdr'

type ClientOption = { id: string; name: string; code: string }

type Props = {
  project: ProjectRow
  settings: MdrSettingsRow | null
  clients: ClientOption[]
  trigger: ReactNode
}

export default function EditProjectDialog({ project, settings, clients, trigger }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(project.name)
  const [clientId, setClientId] = useState(project.client_id ?? '')
  const [processType, setProcessType] = useState<ProcessType | ''>(project.process_type ?? '')
  const [year, setYear] = useState(project.year === null ? '' : String(project.year))
  const [cpyNumbering, setCpyNumbering] = useState(settings?.cpy_numbering ?? false)
  const [cycleIdcToIfr, setCycleIdcToIfr] = useState(String(settings?.cycle_idc_to_ifr ?? ''))
  const [cycleIfrToRetcom, setCycleIfrToRetcom] = useState(String(settings?.cycle_ifr_to_retcom ?? ''))
  const [cycleRetcomToIfc, setCycleRetcomToIfc] = useState(String(settings?.cycle_retcom_to_ifc ?? ''))
  const [budgetHours, setBudgetHours] = useState(settings?.budget_hours === null || settings === null ? '' : String(settings.budget_hours))
  const [status, setStatus] = useState<MdrStatus>(settings?.status ?? 'active')

  const reset = () => {
    setName(project.name)
    setClientId(project.client_id ?? '')
    setProcessType(project.process_type ?? '')
    setYear(project.year === null ? '' : String(project.year))
    setCpyNumbering(settings?.cpy_numbering ?? false)
    setCycleIdcToIfr(String(settings?.cycle_idc_to_ifr ?? ''))
    setCycleIfrToRetcom(String(settings?.cycle_ifr_to_retcom ?? ''))
    setCycleRetcomToIfc(String(settings?.cycle_retcom_to_ifc ?? ''))
    setBudgetHours(settings?.budget_hours === null || settings === null ? '' : String(settings.budget_hours))
    setStatus(settings?.status ?? 'active')
    setError(null)
  }

  const internal = processType !== '' && skipsClientStep(processType)

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)

    // Every field is sent on every save; updateProjectMdr compares each one
    // against the stored row and patches only what differs. Sending the whole
    // form is what makes "the user cleared this field" (null) distinguishable
    // from "the form never carried it" (undefined) — and the diff is what
    // keeps audit_log down to the columns that actually changed.
    const result = await updateProjectMdr({
      projectId: project.id,
      name,
      clientId: internal || clientId === '' ? null : clientId,
      // '' is the "Not classified" option and means NULL, not "leave alone" —
      // the column is nullable and the 20260902114743 backfill deliberately
      // left every SCYYNN code unclassified, so clearing it back has to work.
      processType: processType === '' ? null : processType,
      year: year.trim() === '' ? null : Number(year),
      ...(settings
        ? {
            cpyNumbering: internal ? false : cpyNumbering,
            cycleIdcToIfr: Number(cycleIdcToIfr),
            cycleIfrToRetcom: Number(cycleIfrToRetcom),
            cycleRetcomToIfc: Number(cycleRetcomToIfc),
            budgetHours: budgetHours.trim() === '' ? null : Number(budgetHours),
            status,
          }
        : {}),
    })

    setSaving(false)
    if (!result.ok) {
      setError(result.message ? `${result.error}: ${result.message}` : result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            {settings
              ? 'Only the fields you actually change are written.'
              : 'DCS does not run this project (no MDR settings) — only its identity can be edited here.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label htmlFor="edit-project-name">Name</Label>
            <Input id="edit-project-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-project-code">Project code</Label>
            <Input id="edit-project-code" value={project.project_code} readOnly disabled />
            <p className="text-xs text-gray-500">
              The first segment of every document number in this project — it cannot be changed once issued.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-process-type">Process type</Label>
              <select
                id="edit-process-type"
                className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
                value={processType}
                onChange={(e) => setProcessType(e.target.value as ProcessType | '')}
              >
                <option value="">Not classified</option>
                {PROCESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {PROCESS_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-year">Year</Label>
              <Input id="edit-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-client">Client</Label>
            <select
              id="edit-client"
              className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
              value={internal ? '' : clientId}
              disabled={internal}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">No client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </select>
            {internal && <p className="text-xs text-gray-500">An internal project has no client.</p>}
          </div>

          {settings && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                  checked={internal ? false : cpyNumbering}
                  disabled={internal}
                  onChange={(e) => setCpyNumbering(e.target.checked)}
                />
                CPY numbering
              </label>

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
              <p className="text-xs text-gray-500">
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
                    className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as MdrStatus)}
                  >
                    {MDR_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {MDR_STATUS_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">Documentation open or closed — not the same as Timesheet&apos;s active flag.</p>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-600">Error: {error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving || name.trim() === ''}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
