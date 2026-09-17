'use client'

// DCS 1a.17: the Create Project MDR stepper (brief §9.1) — identification →
// client → review cycle → team and roles → CTR codes → budget.
//
// All six steps hold client state and nothing is written until the last
// "Create project" press, because the write itself is one transaction
// (public.dcs_create_project_mdr, migration 20260911103639). There is no
// half-created project to come back to, so there is no partial state worth
// persisting between steps either.
//
// Every decision this file makes — is the code well formed, is this process
// type client-less, are two CTR codes the same — is a pure function imported
// from lib/project-mdr.ts, the same one createProjectMdr() re-runs on the
// server before it ever reaches the database (vitest.config.ts is node-only,
// so the logic lives there and this component stays a thin shell — the
// convention components/IfRole.tsx set in 1a.12).
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { createProjectMdr } from '@/app/data/actions/project-mdr'
import {
  DEFAULT_CYCLE,
  PROCESS_TYPES,
  PROCESS_TYPE_LABELS,
  duplicateCtrCodes,
  hasDocController,
  isValidProjectCode,
  skipsClientStep,
  type CtrCodeInput,
  type ProcessType,
  type ProjectMdrError,
  type RoleAssignmentInput,
} from '@/lib/project-mdr'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

type ClientOption = { id: string; name: string; code: string }
type Candidate = { id: string; label: string }
type TeamMember = { userId: string; roles: ProjectRole[] }

type Props = {
  clients: ClientOption[]
  candidates: Candidate[]
}

const STEP_TITLES = [
  'Identification',
  'Client',
  'Review cycle',
  'Team and roles',
  'CTR codes',
  'Budget',
] as const

/**
 * The one place a database error code becomes a sentence. Kept beside the
 * step indices so a failure at submit time can send the user back to the step
 * that owns the field — the reason lib/project-mdr.ts returns typed errors
 * instead of a flat 'invalid_input' (see parseCreateProjectMdrInput).
 */
const ERROR_COPY: Record<ProjectMdrError, { message: string; step: number | null }> = {
  unauthenticated: { message: 'Your session has expired — sign in again.', step: null },
  forbidden: { message: 'Only an admin can create a project.', step: null },
  invalid_input: { message: 'Something in the form is not valid.', step: null },
  invalid_project_code: {
    message: 'The project code must be SCYYNN (for example SC2601) or start with SCMS.',
    step: 0,
  },
  duplicate_project_code: { message: 'That project code is already taken.', step: 0 },
  duplicate_ctr_code: { message: 'Two CTR codes in this project are the same.', step: 4 },
  internal_project_has_client: {
    message: 'An internal project has no client and no CPY numbering.',
    step: 1,
  },
  invalid_cycle: { message: 'Each cycle length is a whole number of days, greater than zero.', step: 2 },
  invalid_budget: { message: 'Budget hours must be zero or more.', step: 5 },
  unknown_user: { message: 'One of the people you assigned no longer has a profile.', step: 3 },
  not_found: { message: 'Not found.', step: null },
  db_error: { message: 'The database refused the change.', step: null },
}

export default function CreateProjectWizard({ clients, candidates }: Props) {
  const router = useRouter()
  // DCS 1a.24: "Create project" stays pending across BOTH halves of the
  // finish — the transaction and the push to the new project's page. The old
  // code cleared it before router.push(), so the last thing the user saw
  // after the slowest action in the app was an idle button.
  const { run, pending: submitting } = usePendingAction()
  const [step, setStep] = useState(0)

  // Step 1 — identification
  const [projectCode, setProjectCode] = useState('')
  const [name, setName] = useState('')
  const [processType, setProcessType] = useState<ProcessType>('project')
  const [year, setYear] = useState(String(new Date().getFullYear()))

  // Step 2 — client
  const [clientId, setClientId] = useState('')
  const [cpyNumbering, setCpyNumbering] = useState(false)

  // Step 3 — review cycle (docs/00-glossary.md: 7/10/7 calendar days)
  const [cycleIdcToIfr, setCycleIdcToIfr] = useState(String(DEFAULT_CYCLE.idcToIfr))
  const [cycleIfrToRetcom, setCycleIfrToRetcom] = useState(String(DEFAULT_CYCLE.ifrToRetcom))
  const [cycleRetcomToIfc, setCycleRetcomToIfc] = useState(String(DEFAULT_CYCLE.retcomToIfc))

  // Step 4 — team
  const [team, setTeam] = useState<TeamMember[]>([])
  const [pickedUser, setPickedUser] = useState('')

  // Step 5 — CTR codes
  const [ctrCodes, setCtrCodes] = useState<CtrCodeInput[]>([])
  const [newCtrCode, setNewCtrCode] = useState('')
  const [newCtrDescription, setNewCtrDescription] = useState('')

  // Step 6 — budget
  const [budgetHours, setBudgetHours] = useState('')

  const [submitError, setSubmitError] = useState<string | null>(null)

  const internal = skipsClientStep(processType)
  const nameById = useMemo(() => new Map(candidates.map((c) => [c.id, c.label])), [candidates])
  const roles: RoleAssignmentInput[] = useMemo(
    () => team.flatMap((member) => member.roles.map((role) => ({ userId: member.userId, role }))),
    [team],
  )
  const ctrDuplicates = useMemo(() => duplicateCtrCodes(ctrCodes.map((entry) => entry.code)), [ctrCodes])

  // ---- per-step validity, the thing that gates "Next" -----------------
  const yearNumber = Number(year)
  const yearValid = year.trim() !== '' && Number.isInteger(yearNumber)
  const cycleValues = [cycleIdcToIfr, cycleIfrToRetcom, cycleRetcomToIfc].map(Number)
  const cyclesValid = cycleValues.every((value) => Number.isInteger(value) && value > 0)
  const budgetNumber = budgetHours.trim() === '' ? null : Number(budgetHours)
  const budgetValid = budgetNumber === null || (Number.isFinite(budgetNumber) && budgetNumber >= 0)

  const stepValid = (index: number): boolean => {
    switch (index) {
      case 0:
        return isValidProjectCode(projectCode.trim()) && name.trim() !== '' && yearValid
      case 1:
        return true // client is optional for every process type; internal skips this step entirely
      case 2:
        return cyclesValid
      case 3:
        return true // "no DC" warns, it never blocks
      case 4:
        return ctrDuplicates.length === 0
      case 5:
        return budgetValid
      default:
        return false
    }
  }

  // Internal projects have no client side at all — the step is removed from
  // the stepper rather than disabled, and clientId/cpyNumbering are forced to
  // their empty values on submit so a switch back to Internal after filling
  // the step in cannot leak a client through.
  const visibleSteps = useMemo(
    () => STEP_TITLES.map((title, index) => ({ title, index })).filter(({ index }) => !(internal && index === 1)),
    [internal],
  )
  const position = visibleSteps.findIndex((entry) => entry.index === step)
  const isLast = position === visibleSteps.length - 1

  const goNext = () => {
    if (isLast) return
    setSubmitError(null)
    setStep(visibleSteps[position + 1].index)
  }
  const goBack = () => {
    if (position <= 0) return
    setSubmitError(null)
    setStep(visibleSteps[position - 1].index)
  }

  const toggleRole = (userId: string, role: ProjectRole) => {
    setTeam((prev) =>
      prev.map((member) =>
        member.userId === userId
          ? {
              ...member,
              roles: member.roles.includes(role)
                ? member.roles.filter((r) => r !== role)
                : [...member.roles, role],
            }
          : member,
      ),
    )
  }

  const addMember = () => {
    if (!pickedUser || team.some((member) => member.userId === pickedUser)) return
    setTeam((prev) => [...prev, { userId: pickedUser, roles: [] }])
    setPickedUser('')
  }

  const addCtrCode = () => {
    const code = newCtrCode.trim()
    if (code === '') return
    const description = newCtrDescription.trim()
    setCtrCodes((prev) => [...prev, { code, description: description === '' ? null : description }])
    setNewCtrCode('')
    setNewCtrDescription('')
  }

  const handleSubmit = async () => {
    setSubmitError(null)

    const result = await run(() =>
      createProjectMdr({
      projectCode: projectCode.trim(),
      name: name.trim(),
      processType,
      year: yearNumber,
      // Forced for internal regardless of what step 2 was left holding.
      clientId: internal ? null : clientId === '' ? null : clientId,
      cpyNumbering: internal ? false : cpyNumbering,
      cycleIdcToIfr: cycleValues[0],
      cycleIfrToRetcom: cycleValues[1],
      cycleRetcomToIfc: cycleValues[2],
      budgetHours: budgetNumber,
      roles,
      ctrCodes,
      }),
    )

    if (result === SKIPPED) return
    if (!result.ok) {
      const copy = ERROR_COPY[result.error]
      // The database's own message is appended, not replaced: an off-format
      // project_code that somehow reaches the CHECK should surface what the
      // constraint said, not only our paraphrase of it.
      setSubmitError(result.message ? `${copy.message} (${result.message})` : copy.message)
      if (copy.step !== null && !(internal && copy.step === 1)) setStep(copy.step)
      return
    }

    // Not wrapped in the hook's refresh(): this navigates away rather than
    // re-reading the current page, and `submitting` must stay true until the
    // new page replaces this one.
    router.push(`/admin/projects/${result.data}`)
    router.refresh()
  }

  const unassigned = candidates.filter((candidate) => !team.some((member) => member.userId === candidate.id))

  return (
    <div className="rounded-lg border bg-card p-5">
      {/* Stepper header */}
      <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {visibleSteps.map(({ title, index }, i) => {
          const done = i < position
          const current = index === step
          return (
            <li key={title} className="flex items-center gap-2">
              <span
                className={
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ' +
                  (current
                    ? 'bg-primary text-primary-foreground'
                    : done
                      ? 'bg-success-bg text-success'
                      : 'bg-secondary text-muted-foreground')
                }
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={current ? 'font-semibold' : 'text-muted-foreground'}>{title}</span>
              {i < visibleSteps.length - 1 && <span aria-hidden="true" className="ml-1 h-px w-4 bg-border" />}
            </li>
          )
        })}
      </ol>

      {/* ---------------- Step 1: identification ---------------- */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="project-code">Project code</Label>
            <Input
              id="project-code"
              value={projectCode}
              onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
              placeholder="SC2601"
            />
            {projectCode.trim() !== '' && !isValidProjectCode(projectCode.trim()) ? (
              <p className="text-xs text-destructive">
                Must be SCYYNN (SC2601) or start with SCMS — the same rule the database enforces.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                First segment of every document number in this project (SC2601-SCL-RA-0012-EN).
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="process-type">Process type</Label>
              <select
                id="process-type"
                className={`w-full ${SELECT_CLASS}`}
                value={processType}
                onChange={(e) => setProcessType(e.target.value as ProcessType)}
              >
                {PROCESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {PROCESS_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {internal && <p className="text-xs text-muted-foreground">Internal projects skip the client step.</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-year">Year</Label>
              <Input
                id="project-year"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
              {!yearValid && year.trim() !== '' && <p className="text-xs text-destructive">Year must be a whole number.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Step 2: client ---------------- */}
      {step === 1 && !internal && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="client">Client</Label>
            <select
              id="client"
              className={`w-full ${SELECT_CLASS}`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">No client yet</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </select>
            {clients.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No active clients — add one on the Clients screen first, or leave this empty for now.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring"
              checked={cpyNumbering}
              onChange={(e) => setCpyNumbering(e.target.checked)}
            />
            <span>
              CPY numbering
              <span className="block text-xs text-gray-500">
                The client keeps its own document and revision numbers alongside the SCL track.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* ---------------- Step 3: review cycle ---------------- */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Calendar days between stages. Documents in this project inherit these; the default 7/10/7 totals 24
            days.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="cycle-idc">IDC → IFR</Label>
              <Input id="cycle-idc" inputMode="numeric" value={cycleIdcToIfr} onChange={(e) => setCycleIdcToIfr(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cycle-ifr">IFR → RETCOM</Label>
              <Input id="cycle-ifr" inputMode="numeric" value={cycleIfrToRetcom} onChange={(e) => setCycleIfrToRetcom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cycle-retcom">RETCOM → IFC</Label>
              <Input id="cycle-retcom" inputMode="numeric" value={cycleRetcomToIfc} onChange={(e) => setCycleRetcomToIfc(e.target.value)} />
            </div>
          </div>
          {!cyclesValid && (
            <p className="text-xs text-destructive">Each cycle length is a whole number of days, greater than zero.</p>
          )}
        </div>
      )}

      {/* ---------------- Step 4: team and roles ---------------- */}
      {step === 3 && (
        <div className="space-y-4">
          {!hasDocController(roles) && (
            <div className="rounded-lg border border-warning/25 bg-warning-bg p-3 text-sm text-warning">
              No Document Controller assigned. You can still create the project — but the DC is the only role
              that issues numbers and closes the review cycle, and is who will see this project on /dcs.
            </div>
          )}

          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one assigned yet.</p>
          ) : (
            <div className="space-y-3">
              {team.map((member) => (
                <div key={member.userId} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {nameById.get(member.userId) ?? `${member.userId.slice(0, 8)}…`}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => setTeam((prev) => prev.filter((m) => m.userId !== member.userId))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {PROJECT_ROLES.map((role) => (
                      <label key={role} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring"
                          checked={member.roles.includes(role)}
                          onChange={() => toggleRole(member.userId, role)}
                        />
                        {ROLE_LABELS[role]}
                      </label>
                    ))}
                  </div>
                  {member.roles.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No role ticked — this person will not be added to the project.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {unassigned.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3">
              <select
                className={SELECT_CLASS}
                value={pickedUser}
                onChange={(e) => setPickedUser(e.target.value)}
              >
                <option value="">Add someone…</option>
                {unassigned.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={addMember} disabled={!pickedUser}>
                Add
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Step 5: CTR codes ---------------- */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            CTR codes (public.sub_projects) are per project, so this project has none yet — add them here.
            Documents and Timesheet hours are both booked against them.
          </p>

          {ctrCodes.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {ctrCodes.map((entry, index) => (
                <li key={`${entry.code}-${index}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    <span
                      className={
                        ctrDuplicates.includes(entry.code) ? 'font-mono text-destructive' : 'font-mono'
                      }
                    >
                      {entry.code}
                    </span>
                    {entry.description && <span className="ml-2 text-muted-foreground">{entry.description}</span>}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => setCtrCodes((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {ctrDuplicates.length > 0 && (
            <p className="text-xs text-destructive">
              Repeated CTR code(s): {ctrDuplicates.join(', ')}. Codes are unique within a project, and are
              compared exactly — CTR100 and ctr100 would be two different codes.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-3">
            <div className="space-y-1">
              <Label htmlFor="ctr-code">Code</Label>
              <Input
                id="ctr-code"
                className="w-56"
                value={newCtrCode}
                onChange={(e) => setNewCtrCode(e.target.value)}
                placeholder="SC2601_CTR100"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctr-description">Description</Label>
              <Input
                id="ctr-description"
                className="w-64"
                value={newCtrDescription}
                onChange={(e) => setNewCtrDescription(e.target.value)}
              />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addCtrCode} disabled={newCtrCode.trim() === ''}>
              Add code
            </Button>
          </div>
        </div>
      )}

      {/* ---------------- Step 6: budget + summary ---------------- */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="budget-hours">Budget hours</Label>
            <Input
              id="budget-hours"
              inputMode="decimal"
              className="w-48"
              value={budgetHours}
              onChange={(e) => setBudgetHours(e.target.value)}
              placeholder="optional"
            />
            {budgetValid ? (
              <p className="text-xs text-muted-foreground">Leave empty for no budget.</p>
            ) : (
              <p className="text-xs text-destructive">Budget hours must be zero or more.</p>
            )}
          </div>

          <dl className="rounded-lg border bg-muted p-3 text-sm">
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-mono">{projectCode || '—'}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Process type</dt>
              <dd>
                {PROCESS_TYPE_LABELS[processType]} · {year || '—'}
              </dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Client</dt>
              <dd>
                {internal
                  ? 'none (internal)'
                  : (clients.find((client) => client.id === clientId)?.code ?? 'none')}
                {!internal && cpyNumbering ? ' · CPY numbering' : ''}
              </dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Review cycle</dt>
              <dd>
                {cycleIdcToIfr}/{cycleIfrToRetcom}/{cycleRetcomToIfc} days
              </dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Team</dt>
              <dd>
                {roles.length} role{roles.length === 1 ? '' : 's'}
                {hasDocController(roles) ? '' : ' · no DC'}
              </dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">CTR codes</dt>
              <dd>{ctrCodes.length}</dd>
            </div>
          </dl>
        </div>
      )}

      {submitError && <p className="mt-4 text-sm text-destructive">Error: {submitError}</p>}

      {/* ---------------- Navigation ---------------- */}
      <div className="mt-6 flex items-center justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={goBack} disabled={position <= 0 || submitting}>
          Back
        </Button>
        {isLast ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !visibleSteps.every(({ index }) => stepValid(index))}
          >
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {submitting ? 'Creating…' : 'Create project'}
          </Button>
        ) : (
          <Button type="button" onClick={goNext} disabled={!stepValid(step)}>
            Next
          </Button>
        )}
      </div>
    </div>
  )
}
