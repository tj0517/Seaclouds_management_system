'use client'

// DCS 1b.04: the New Document form.
//
// A thin shell, the convention components/IfRole.tsx set in 1a.12 and
// CreateProjectWizard.tsx follows: every decision it makes — what a document
// type suggests as a budget, whether the Originator clashes with the Checker,
// what an error code means — is a pure function imported from lib/documents.ts,
// the same one createDocument() re-runs on the server before the database sees
// anything. vitest.config.ts is node-only, so the logic lives there and is
// tested there (lib/documents.test.ts).
//
// Nothing is fetched here. Changing the project narrows lists that were all
// loaded by the RSC (docs/03-conventions.md: no client-side fetching), which
// is why ctrByProject and teamsByProject arrive as whole maps.
//
// The SCL number has no field, deliberately. It is not disabled, not
// read-only, not hidden — it does not exist, because the system assigns it on
// INSERT (trigger documents_assign_scl_number, 1b.02) and supplying one is
// refused outright. There is nothing here for a user to fill in or for a
// devtools edit to smuggle through.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { Callout } from '@/components/page-chrome'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { createDocument } from '@/app/data/actions/documents'
import {
  DEFAULT_LANGUAGE_CODE,
  budgetHoursFromMeta,
  originatorIsChecker,
  type CtrOption,
  type TeamMember,
} from '@/lib/documents'
import type { DictionaryRow } from '@/lib/dictionaries'
import type { DirectoryEntry } from '@/lib/profile-directory'

type ProjectOption = { id: string; name: string; project_code: string | null; hasMdr: boolean }

export default function DocumentCreateForm({
  currentUserId,
  projects,
  docTypes,
  disciplines,
  areas,
  languages,
  ctrByProject,
  teamsByProject,
  directory,
}: {
  currentUserId: string
  projects: ProjectOption[]
  docTypes: DictionaryRow[]
  disciplines: DictionaryRow[]
  areas: DictionaryRow[]
  languages: DictionaryRow[]
  ctrByProject: Record<string, CtrOption[]>
  teamsByProject: Record<string, TeamMember[]>
  directory: DirectoryEntry[]
}) {
  const router = useRouter()
  const { run, pending } = usePendingAction()

  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [docTypeId, setDocTypeId] = useState('')
  const [disciplineId, setDisciplineId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [languageId, setLanguageId] = useState(
    () => languages.find((row) => row.code === DEFAULT_LANGUAGE_CODE)?.id ?? languages[0]?.id ?? '',
  )
  const [ctrCode, setCtrCode] = useState('')
  const [originatorId, setOriginatorId] = useState(currentUserId)
  const [checkerId, setCheckerId] = useState('')
  const [approverId, setApproverId] = useState('')
  // A string, not a number: this field is pre-filled from the document type
  // and then edited by hand, and '' has to stay distinguishable from 0.
  const [budgetHours, setBudgetHours] = useState('')
  const [error, setError] = useState<string | null>(null)

  const project = projects.find((candidate) => candidate.id === projectId)
  const nameById = useMemo(
    () => new Map(directory.map((entry) => [entry.id, entry.full_name])),
    [directory],
  )

  const ctrOptions = ctrByProject[projectId] ?? []

  // Staffing candidates: everyone holding ANY role on this project. Narrowing
  // Checker to role 'chk' and Approver to 'app' is deliberately NOT done —
  // the database does not enforce that rule (1b.01 deferred it and 1b.04 left
  // it deferred, see docs/deferred-tasks.md), and a dropdown stricter than the
  // rule would quietly block staffing the database would accept.
  const team = useMemo(() => {
    const members = teamsByProject[projectId] ?? []
    return members
      .map((member) => ({
        id: member.userId,
        label: nameById.get(member.userId) ?? `${member.userId.slice(0, 8)}…`,
        roles: member.roles,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [teamsByProject, projectId, nameById])

  const clash = originatorIsChecker({
    originatorId: originatorId === '' ? null : originatorId,
    checkerId: checkerId === '' ? null : checkerId,
  })
  const missingMdr = project !== undefined && !project.hasMdr
  const incomplete = projectId === '' || title.trim() === '' || docTypeId === '' || disciplineId === '' || areaId === '' || languageId === ''

  function onDocTypeChange(nextId: string) {
    setDocTypeId(nextId)
    // Pre-fill from the type's dictionary meta, and leave it editable. The row
    // whose meta carries no budget_hours (ZZT on scl-dev) simply clears the
    // suggestion instead of throwing — budgetHoursFromMeta returns null.
    const suggestion = budgetHoursFromMeta(docTypes.find((row) => row.id === nextId)?.meta)
    setBudgetHours(suggestion === null ? '' : String(suggestion))
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await run(() =>
      createDocument({
        projectId,
        title,
        docTypeId,
        disciplineId,
        areaId,
        languageId,
        ctrCode,
        originatorId,
        checkerId,
        approverId,
        budgetHours,
      }),
    )
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    router.push(`/documents/${result.data}`)
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
      {error ? <Callout tone="error">{error}</Callout> : null}

      {missingMdr ? (
        <Callout tone="warning">
          DCS does not run <strong>{project?.project_code ?? project?.name}</strong> yet: it has no MDR
          configuration. Its Document Controller must create the project MDR before any document can be added here.
        </Callout>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="project">Project</Label>
          <select
            id="project"
            className={`w-full ${SELECT_CLASS}`}
            value={projectId}
            disabled={pending}
            onChange={(e) => {
              setProjectId(e.target.value)
              // CTR codes and staffing belong to the project that was chosen;
              // carrying them across would post a CTR code of another project
              // (refused by documents_ctr_code_project) or a Checker with no
              // role on the new one.
              setCtrCode('')
              setCheckerId('')
              setApproverId('')
            }}
          >
            {projects.map((option) => (
              <option key={option.id} value={option.id}>
                {option.project_code ?? option.name} — {option.name}
                {option.hasMdr ? '' : ' (no MDR)'}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ctr">CTR code</Label>
          <select
            id="ctr"
            className={`w-full ${SELECT_CLASS}`}
            value={ctrCode}
            disabled={pending || ctrOptions.length === 0}
            onChange={(e) => setCtrCode(e.target.value)}
          >
            <option value="">{ctrOptions.length === 0 ? 'This project has no CTR codes' : 'Not booked to a CTR'}</option>
            {ctrOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.code}
                {option.description ? ` — ${option.description}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          disabled={pending}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Geophysical survey report, Baltic Sea, Poland"
        />
        <p className="text-xs text-muted-foreground">
          Say what kind of work it is, the discipline, the location and the country — the title is how this document
          is found in the register.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="docType">Document type</Label>
          <select
            id="docType"
            className={`w-full ${SELECT_CLASS}`}
            value={docTypeId}
            disabled={pending}
            onChange={(e) => onDocTypeChange(e.target.value)}
          >
            <option value="">Choose a type…</option>
            {docTypes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget hours</Label>
          <Input
            id="budget"
            type="number"
            min={0}
            step="any"
            value={budgetHours}
            disabled={pending}
            onChange={(e) => setBudgetHours(e.target.value)}
            placeholder="From the document type"
          />
          <p className="text-xs text-muted-foreground">
            Suggested by the document type. Change it and your value is what gets saved.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="discipline">Discipline</Label>
          <select
            id="discipline"
            className={`w-full ${SELECT_CLASS}`}
            value={disciplineId}
            disabled={pending}
            onChange={(e) => setDisciplineId(e.target.value)}
          >
            <option value="">Choose a discipline…</option>
            {disciplines.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="area">Area</Label>
          <select
            id="area"
            className={`w-full ${SELECT_CLASS}`}
            value={areaId}
            disabled={pending}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">Choose an area…</option>
            {areas.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <select
            id="language"
            className={`w-full ${SELECT_CLASS}`}
            value={languageId}
            disabled={pending}
            onChange={(e) => setLanguageId(e.target.value)}
          >
            {languages.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">The LANG segment of the document number.</p>
        </div>
      </div>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Staffing</legend>
        {team.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nobody holds a DCS role on this project yet, so there is nobody to assign.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ['originator', 'Originator', originatorId, setOriginatorId],
              ['checker', 'Checker', checkerId, setCheckerId],
              ['approver', 'Approver', approverId, setApproverId],
            ] as const
          ).map(([id, label, value, set]) => (
            <div key={id} className="space-y-1.5">
              <Label htmlFor={id}>{label}</Label>
              <select
                id={id}
                className={`w-full ${SELECT_CLASS}`}
                value={value}
                disabled={pending}
                onChange={(e) => set(e.target.value)}
              >
                <option value="">Nobody yet</option>
                {team.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label} ({member.roles.join(', ')})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {clash ? (
          <Callout tone="error">
            The Originator cannot also be the Checker of the same document. The database refuses this too
            (documents_originator_not_checker) — this message just saves you the round trip.
          </Callout>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || clash || missingMdr || incomplete}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {pending ? 'Creating…' : 'Create document'}
        </Button>
        <p className="text-xs text-muted-foreground">
          The SCL number is assigned on save and can never be changed.
        </p>
      </div>
    </form>
  )
}
