'use server'

// DCS 1b.04: the New Document form's server action. Logic lives in
// lib/documents.ts (framework-agnostic, unit tested); this file binds it to
// the session client and revalidates the two pages that read the new row.
// Same split as app/data/actions/project-mdr.ts.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import { createDocument as createWith, type ActionResult } from '@/lib/documents'

export async function createDocument(input: unknown): Promise<ActionResult<string>> {
  const supabase = await createClient()
  const result = await createWith(supabase, input)
  if (result.ok) {
    // The project's document list, and the profile the user is about to land
    // on. The project id is not in scope here (the action returns only the new
    // document id), so the list is revalidated through the layout segment that
    // covers every project — cheaper than re-reading the row to learn its
    // project just to name one path.
    revalidatePath('/projects/[projectId]/documents', 'page')
    revalidatePath(`/documents/${result.data}`)
  }
  return result
}
