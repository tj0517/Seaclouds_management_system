'use server'

// DCS 1a.17 → 1b.24: "Enable DCS" wizard + EditProjectDialog server actions.
// Logic lives in lib/project-mdr.ts (framework-agnostic, unit tested); this
// file binds it to the session client and revalidates the pages that read the
// affected rows. Same split as app/data/actions/clients.ts.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  enableProjectMdr as enableWith,
  updateProjectMdr as updateWith,
  type ActionResult,
  type EnableProjectMdrInput,
  type ProjectMdr,
  type UpdateProjectMdrInput,
} from '@/lib/project-mdr'

export async function enableProjectMdr(input: EnableProjectMdrInput): Promise<ActionResult<string>> {
  const supabase = await createClient()
  const result = await enableWith(supabase, input)
  if (result.ok) {
    // The project list at /, the project's own team page, and its document
    // list — "DCS does not run this project" disappears from the latter the
    // moment this revalidates.
    revalidatePath('/')
    revalidatePath(`/admin/projects/${result.data}`)
    revalidatePath(`/projects/${result.data}/documents`)
  }
  return result
}

export async function updateProjectMdr(input: UpdateProjectMdrInput): Promise<ActionResult<ProjectMdr>> {
  const supabase = await createClient()
  const result = await updateWith(supabase, input)
  if (result.ok) {
    revalidatePath('/')
    revalidatePath(`/admin/projects/${input.projectId}`)
  }
  return result
}
