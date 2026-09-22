'use server'

// DCS 1b.08: the New Revision dialog's server actions. Logic lives in
// lib/revisions.ts (framework-agnostic, unit tested); this file binds it to the
// session client and revalidates the pages that read the new row. Same split as
// app/data/actions/documents.ts.
//
// Authorization is the database's — RLS on dcs.revisions and the triggers
// revisions_assign_scl_revision / revisions_refuse_void_document /
// revisions_numbering_dc_only_insert — and no guard is duplicated here on
// purpose: a check in front would be a second copy of the rule that can drift
// from it.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  createRevision as createWith,
  lockRevision as lockWith,
  proposeRevisionCode as proposeWith,
  type RevisionResult,
} from '@/lib/revisions'

/**
 * The code the database would assign right now for this document and step.
 * A proposal only — the stored code is computed again inside the insert.
 */
export async function proposeRevisionCode(input: unknown): Promise<RevisionResult<{ code: string }>> {
  const supabase = await createClient()
  return proposeWith(supabase, input)
}

/**
 * Creates a revision. On success the database has already made it the
 * document's current revision, moved a NOT_STARTED document to STARTED and
 * marked the previous revision SUPERSEDED (trigger revisions_promote_current);
 * what this wrapper adds is revalidation of every page that shows any of that:
 * the profile (Revisions tab, current-revision panel, History), /mdr (dcs.v_mdr
 * reads the current revision's code and date and the document's status) and the
 * project's document list (the status badge).
 */
export async function createRevision(input: unknown): Promise<RevisionResult<{ id: string; sclRevision: string }>> {
  const supabase = await createClient()
  const result = await createWith(supabase, input)
  if (result.ok) {
    const documentId =
      typeof input === 'object' && input !== null && typeof (input as { documentId?: unknown }).documentId === 'string'
        ? (input as { documentId: string }).documentId
        : null
    if (documentId) revalidatePath(`/documents/${documentId}`)
    revalidatePath('/mdr')
    revalidatePath('/projects/[projectId]/documents', 'page')
  }
  return result
}

/**
 * DCS 1b.11: approves (locks) a revision. Authorization is the database's
 * (revisions_locked_at_dc_only, revisions_locked_at_final_step); see
 * lockRevision in lib/revisions.ts. `documentId` is read only to revalidate
 * the profile — lockWith never receives it, so it cannot change what gets
 * written.
 */
export async function lockRevision(input: unknown): Promise<RevisionResult<{ id: string; lockedAt: string }>> {
  const supabase = await createClient()
  const result = await lockWith(supabase, input)
  if (result.ok) {
    const documentId =
      typeof input === 'object' && input !== null && typeof (input as { documentId?: unknown }).documentId === 'string'
        ? (input as { documentId: string }).documentId
        : null
    if (documentId) revalidatePath(`/documents/${documentId}`)
    revalidatePath('/mdr')
  }
  return result
}
