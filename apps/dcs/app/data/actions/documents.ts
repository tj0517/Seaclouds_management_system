'use server'

// DCS 1b.04: the New Document form's server action. Logic lives in
// lib/documents.ts (framework-agnostic, unit tested); this file binds it to
// the session client and revalidates the two pages that read the new row.
// Same split as app/data/actions/project-mdr.ts.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  createDocument as createWith,
  setCpyNumber as setCpyNumberWith,
  setDocumentStatus as setDocumentStatusWith,
  voidDocument as voidDocumentWith,
  type ActionResult,
} from '@/lib/documents'

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

/**
 * DCS 1b.07: set (or clear) a document's CPY number from the profile.
 *
 * The authorization is the database's (trigger documents_numbering_dc_only,
 * 1b.03, and RLS "Doc controllers update documents"); see setCpyNumber in
 * lib/documents.ts. What this wrapper adds is revalidation: the profile
 * itself, so the field and the History tab re-read (the audit_log row the
 * trigger wrote is what the tab lists), and /mdr, whose CPY column reads the
 * same value through dcs.v_mdr.
 */
export async function setCpyNumber(
  input: unknown,
): Promise<ActionResult<{ documentId: string; cpyNumber: string | null }>> {
  const supabase = await createClient()
  const result = await setCpyNumberWith(supabase, input)
  if (result.ok) {
    revalidatePath(`/documents/${result.data.documentId}`)
    revalidatePath('/mdr')
  }
  return result
}

/**
 * DCS 1b.11: manual status change from the profile. Authorization is the
 * database's (trigger documents_workflow_status_dc_only); see
 * setDocumentStatus in lib/documents.ts. /mdr shows the status too
 * (dcs.v_mdr), so it revalidates alongside the profile.
 */
export async function setDocumentStatus(
  input: unknown,
): Promise<ActionResult<{ documentId: string; statusCode: string }>> {
  const supabase = await createClient()
  const result = await setDocumentStatusWith(supabase, input)
  if (result.ok) {
    revalidatePath(`/documents/${result.data.documentId}`)
    revalidatePath('/mdr')
  }
  return result
}

/**
 * DCS 1b.11: Void a document, with its mandatory reason. Authorization is the
 * database's (enforce_document_void, and documents_workflow_status_dc_only
 * for workflow_status_id itself); see voidDocument in lib/documents.ts.
 */
export async function voidDocument(
  input: unknown,
): Promise<ActionResult<{ documentId: string; voidReason: string }>> {
  const supabase = await createClient()
  const result = await voidDocumentWith(supabase, input)
  if (result.ok) {
    revalidatePath(`/documents/${result.data.documentId}`)
    revalidatePath('/mdr')
  }
  return result
}
