'use server'

// DCS 1b.09 (PR 2): the file actions of the document profile. Logic lives in
// lib/files.ts (framework-agnostic, unit tested); this file binds it to the
// SESSION client and revalidates the profile after a row is written. Same split
// as app/data/actions/revisions.ts.
//
// The session client is the point, not a convenience: both signing calls are
// made as the signed-in user, so the storage-api applies the bucket policies of
// PR 1 (migration 20260921112840) as that user before it signs. An admin client
// (the key that bypasses RLS) here would bypass them — including the O-16
// narrowing that keeps file bytes from Timesheet-only members — and is never used.
//
// No route handler: the download is a server action that returns the refusal
// as data and, on success, the short-lived signed URL as data — the button
// then navigates the browser to it itself (window.location.assign). NOT
// redirect(): a server-action redirect to an external URL makes the Next
// client router treat it as a full-page navigation (handleExternalUrl →
// location.assign) and record that URL as the router's canonical URL. The
// signed URL answers with Content-Disposition: attachment, so the page never
// unloads, and every later server action on the page was POSTed to the
// storage URL (400) until a reload — PR #81 review 5, seen on a Preview as
// "a JPG upload after a download fails". server-action-reducer.js posts to
// state.canonicalUrl, so nothing short of a reload recovers from it.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  downloadUrl as downloadWith,
  prepareUpload as prepareWith,
  recordUpload as recordWith,
  type FileResult,
  type PreparedUpload,
} from '@/lib/files'

/** Step 1 of an upload: the generated name, the object key and a signed upload URL for them. */
export async function prepareFileUpload(input: unknown): Promise<FileResult<PreparedUpload>> {
  const supabase = await createClient()
  return prepareWith(supabase, input)
}

/**
 * Step 3 of an upload (step 2 is the browser's PUT to the signed URL): the
 * dcs.files row. On success the profile is revalidated — the panel's file
 * list and the Revisions tab both read the table.
 */
export async function recordFileUpload(input: unknown): Promise<FileResult<{ id: string; documentId: string; fileName: string }>> {
  const supabase = await createClient()
  const result = await recordWith(supabase, input)
  if (result.ok) revalidatePath(`/documents/${result.data.documentId}`)
  return result
}

/**
 * Checks access by asking the database and the storage-api as the caller
 * (lib/files.ts downloadUrl) and returns the signed URL for the caller to
 * navigate to. A refusal — a row RLS hides, an object the SELECT policy
 * hides, an object that is not there — is returned as
 * { ok: false, error: 'forbidden' } with the one sentence, shown in place.
 */
export async function downloadFile(input: unknown): Promise<FileResult<{ url: string }>> {
  const supabase = await createClient()
  const result = await downloadWith(supabase, input)
  if (!result.ok) return result
  return { ok: true, data: { url: result.data.url } }
}
