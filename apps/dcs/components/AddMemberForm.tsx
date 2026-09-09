'use client'

// DCS 1a.14: adds a first role for someone not yet on the project's team,
// from the "per project" view. Candidates come from
// public.dcs_profile_directory() (1a.14b) minus the current team — for an
// admin or any DC that's the whole directory; renders whatever candidate
// list it's given either way.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setProjectRoles } from '@/app/data/actions/project-roles'
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from '@/lib/project-roles'

type Candidate = { id: string; label: string }

type Props = {
  projectId: string
  candidates: Candidate[]
}

export default function AddMemberForm({ projectId, candidates }: Props) {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [roles, setRoles] = useState<ProjectRole[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (role: ProjectRole) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleAdd = async () => {
    if (!userId || roles.length === 0) return
    setSaving(true)
    setError(null)
    const result = await setProjectRoles({ projectId, userId, roles })
    setSaving(false)
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setUserId('')
    setRoles([])
    router.refresh()
  }

  if (candidates.length === 0) {
    return <p className="text-xs text-gray-500">No other profiles readable from this session to add.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4">
      <select
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      >
        <option value="">Add a member…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {PROJECT_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-1.5 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
            checked={roles.includes(role)}
            onChange={() => toggle(role)}
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        disabled={!userId || roles.length === 0 || saving}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {saving ? 'Adding…' : 'Add'}
      </button>
      {error && <span className="text-xs text-red-600">Error: {error}</span>}
    </div>
  )
}
