'use client'

// DCS 1b.24: "Enable DCS" — turns DCS on for a project Timesheet already
// owns. Replaces the 1a.17 Create Project MDR wizard (client agreement, tj
// 2026-09-25): DCS no longer creates projects, so there is no identification,
// client or CTR-codes step here — those fields are Timesheet's, read-only.
//
// Five steps: pick the project → review cycle → CPY numbering → team and
// roles → budget. Nothing is written until the last "Enable DCS" press,
// because the write itself is one transaction
// (public.dcs_enable_project_mdr, migration 20260925111841) — same reasoning
// as the wizard this replaces.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { enableProjectMdr } from '@/app/data/actions/project-mdr'
import {
  DEFAULT_CYCLE,
  PROCESS_TYPE_LABELS,
  hasDocController,
  type ProjectMdrError,
  type ProjectWithoutMdr,
  type RoleAssignmentInput,
} from '@/lib/project-mdr'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

type Candidate = { id: string; label: string }
type TeamMember = { userId: string; roles: ProjectRole[] }

type Props = {
  projects: ProjectWithoutMdr[]
  candidates: Candidate[]
}

const STEP_TITLES = ['Project', 'Review cycle', 'CPY numbering', 'Team and roles', 'Budget'] as const

/**
 * The one place a database error code becomes a sentence. Kept beside the
 * step indices so a failure at submit time can send the user back to the
 * step that owns the field, the same reason lib/project-mdr.ts returns typed
 * errors instead of a flat 'invalid_input'.
 */
const ERROR_COPY: Record<ProjectMdrError, { message: string; step: number | null }> = {
  unauthenticated: { message: 'Your session has expired — sign in again.', step: null },
  forbidden: { message: 'Only an admin can enable DCS for a project.', step: null },
  invalid_input: { message: 'Something in the form is not valid.', step: null },
  already_enabled: {
    message: 'DCS is already enabled for this project — someone else enabled it in the meantime.',
    step: 0,
  },
  internal_project_has_client: { message: 'This project has no client and no CPY numbering.', step: 2 },
  cpy_needs_client: { message: 'CPY numbering needs a client, and this project has none.', step: 2 },
  invalid_cycle: { message: 'Each cycle length is a whole number of days, greater than zero.', step: 1 },
  invalid_budget: { message: 'Budget hours must be zero or more.', step: 4 },
  unknown_user: { message: 'One of the people you assigned no longer has a profile.', step: 3 },
  not_found: { message: 'This project no longer exists.', step: 0 },
  db_error: { message: 'The database refused the change.', step: null },
}

export default function EnableDcsWizard({ projects, candidates }: Props) {
  const router = useRouter()
  const { run, pending: submitting } = usePendingAction()
  const [step, setStep] = useState(0)

  // Step 0 — project
  const [projectId, setProjectId] = useState('')

  // Step 1 — review cycle
  const [cycleIdcToIfr, setCycleIdcToIfr] = useState(String(DEFAULT_CYCLE.idcToIfr))
  const [cycleIfrToRetcom, setCycleIfrToRetcom] = useState(String(DEFAULT_CYCLE.ifrToRetcom))
  const [cycleRetcomToIfc, setCycleRetcomToIfc] = useState(String(DEFAULT_CYCLE.retcomToIfc))

  // Step 2 — CPY numbering
  const [cpyNumbering, setCpyNumbering] = useState(false)

  // Step 3 — team
  const [team, setTeam] = useState<TeamMember[]>([])
  const [pickedUser, setPickedUser] = useState('')

  // Step 4 — budget
  const [budgetHours, setBudgetHours] = useState('')

  const [submitError, setSubmitError] = useState<string | null>(null)

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId])
  const hasClient = project?.clientId != null
  const nameById = useMemo(() => new Map(candidates.map((c) => [c.id, c.label])), [candidates])
  const roles: RoleAssignmentInput[] = useMemo(
    () => team.flatMap((member) => member.roles.map((role) => ({ userId: member.userId, role }))),
    [team],
  )

  // ---- per-step validity, the thing that gates "Next" -----------------
  const cycleValues = [cycleIdcToIfr, cycleIfrToRetcom, cycleRetcomToIfc].map(Number)
  const cyclesValid = cycleValues.every((value) => Number.isInteger(value) && value > 0)
  const budgetNumber = budgetHours.trim() === '' ? null : Number(budgetHours)
  const budgetValid = budgetNumber === null || (Number.isFinite(budgetNumber) && budgetNumber >= 0)

  const stepValid = (index: number): boolean => {
    switch (index) {
      case 0:
        return project !== null
      case 1:
        return cyclesValid
      case 2:
        return true // unchecked is always valid; the checkbox itself is disabled without a client
      case 3:
        // "At least one DC" (task decision, tj 2026-09-25) — a block here, not
        // only a warning, unlike the 1a.17 wizard's "no DC" case: that one
        // still let admin choose the DC later on /admin/projects/<id>; this
        // wizard is the only place team assignment happens at enable time.
        return hasDocController(roles)
      case 4:
        return budgetValid
      default:
        return false
    }
  }

  const isLast = step === STEP_TITLES.length - 1

  const goNext = () => {
    if (isLast) return
    setSubmitError(null)
    setStep((s) => s + 1)
  }
  const goBack = () => {
    if (step <= 0) return
    setSubmitError(null)
    setStep((s) => s - 1)
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

  const handleSubmit = async () => {
    if (!project) return
    setSubmitError(null)

    const result = await run(() =>
      enableProjectMdr({
        projectId: project.id,
        // Forced false when the project has no client, regardless of what
        // the checkbox was left holding before a different project was
        // picked — the same "force on submit" shape as the create wizard's
        // internal-projects rule.
        cpyNumbering: hasClient ? cpyNumbering : false,
        cycleIdcToIfr: cycleValues[0],
        cycleIfrToRetcom: cycleValues[1],
        cycleRetcomToIfc: cycleValues[2],
        budgetHours: budgetNumber,
        roles,
      }),
    )

    if (result === SKIPPED) return
    if (!result.ok) {
      const copy = ERROR_COPY[result.error]
      setSubmitError(result.message ? `${copy.message} (${result.message})` : copy.message)
      if (copy.step !== null) setStep(copy.step)
      return
    }

    // Stays pending across both halves of the finish, same as the create
    // wizard: the transaction, then the push to the project's page.
    router.push(`/admin/projects/${result.data}`)
    router.refresh()
  }

  const unassigned = candidates.filter((candidate) => !team.some((member) => member.userId === candidate.id))

  return (
    <div className="rounded-lg border bg-card p-5">
      {/* Stepper header */}
      <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {STEP_TITLES.map((title, index) => {
          const done = index < step
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
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className={current ? 'font-semibold' : 'text-muted-foreground'}>{title}</span>
              {index < STEP_TITLES.length - 1 && <span aria-hidden="true" className="ml-1 h-px w-4 bg-border" />}
            </li>
          )
        })}
      </ol>

      {/* ---------------- Step 0: project ---------------- */}
      {step === 0 && (
        <div className="space-y-4">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every project in Timesheet already has DCS enabled — there is nothing left to turn on.
            </p>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="enable-project">Project</Label>
              <select
                id="enable-project"
                className={`w-full ${SELECT_CLASS}`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Choose a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode} — {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {project && (
            <dl className="rounded-lg border bg-muted p-3 text-sm">
              <div className="flex justify-between py-0.5">
                <dt className="text-muted-foreground">Code</dt>
                <dd className="font-mono">{project.projectCode}</dd>
              </div>
              <div className="flex justify-between py-0.5">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{project.name}</dd>
              </div>
              <div className="flex justify-between py-0.5">
                <dt className="text-muted-foreground">Client</dt>
                <dd>{hasClient ? 'has a client' : 'no client'}</dd>
              </div>
              <div className="flex justify-between py-0.5">
                <dt className="text-muted-foreground">Process type</dt>
                <dd>{project.processType ? PROCESS_TYPE_LABELS[project.processType] : 'not classified'}</dd>
              </div>
              <div className="flex justify-between py-0.5">
                <dt className="text-muted-foreground">Year</dt>
                <dd>{project.year ?? '—'}</dd>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                These fields belong to Timesheet — DCS only shows them here.
              </p>
            </dl>
          )}
        </div>
      )}

      {/* ---------------- Step 1: review cycle ---------------- */}
      {step === 1 && (
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

      {/* ---------------- Step 2: CPY numbering ---------------- */}
      {step === 2 && (
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              checked={hasClient && cpyNumbering}
              disabled={!hasClient}
              onChange={(e) => setCpyNumbering(e.target.checked)}
            />
            <span>
              CPY numbering
              <span className="block text-xs text-gray-500">
                The client keeps its own document and revision numbers alongside the SCL track.
              </span>
            </span>
          </label>
          {!hasClient && (
            <p className="text-xs text-muted-foreground">
              Unavailable: this project has no client in Timesheet, and the CPY track is the client&apos;s own
              numbering.
            </p>
          )}
        </div>
      )}

      {/* ---------------- Step 3: team and roles ---------------- */}
      {step === 3 && (
        <div className="space-y-4">
          {!hasDocController(roles) && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
              At least one Document Controller is required — DCS can only be enabled once this project has a DC.
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

      {/* ---------------- Step 4: budget + summary ---------------- */}
      {step === 4 && (
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
              <dd className="font-mono">{project?.projectCode ?? '—'}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Review cycle</dt>
              <dd>
                {cycleIdcToIfr}/{cycleIfrToRetcom}/{cycleRetcomToIfc} days
              </dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">CPY numbering</dt>
              <dd>{hasClient && cpyNumbering ? 'yes' : 'no'}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-muted-foreground">Team</dt>
              <dd>{roles.length} role{roles.length === 1 ? '' : 's'}</dd>
            </div>
          </dl>
        </div>
      )}

      {submitError && <p className="mt-4 text-sm text-destructive">Error: {submitError}</p>}

      {/* ---------------- Navigation ---------------- */}
      <div className="mt-6 flex items-center justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={goBack} disabled={step <= 0 || submitting}>
          Back
        </Button>
        {isLast ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !STEP_TITLES.every((_, index) => stepValid(index))}
          >
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {submitting ? 'Enabling…' : 'Enable DCS'}
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
