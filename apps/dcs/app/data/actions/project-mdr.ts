'use server'

// DCS 1a.17: Create Project MDR wizard + EditProjectDialog server actions.
// Logic lives in lib/project-mdr.ts (framework-agnostic, unit tested); this
// file binds it to the session client and revalidates the pages that read the
// affected rows. Same split as app/data/actions/clients.ts.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  createProjectMdr as createWith,
  updateProjectMdr as updateWith,
  type ActionResult,
  type CreateProjectMdrInput,
  type ProjectMdr,
  type UpdateProjectMdrInput,
} from '@/lib/project-mdr'

export async function createProjectMdr(input: CreateProjectMdrInput): Promise<ActionResult<string>> {
  const supabase = await createClient()
  const result = await createWith(supabase, input)
  if (result.ok) {
    // The project list at / and the new project's own team page. The team
    // page did not exist a moment ago, so this is really only about the list.
    revalidatePath('/')
    revalidatePath(`/admin/projects/${result.data}`)
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
