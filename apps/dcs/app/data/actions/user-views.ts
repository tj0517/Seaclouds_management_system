'use server'

// DCS 1b.06: server actions for the MDR register's saved views. Logic lives in
// lib/user-views.ts (framework-agnostic, unit tested); this file binds it to
// the session client and revalidates the register. Same split as
// app/data/actions/documents.ts.
//
// No guard in this file, and that is not an omission: dcs.user_views has four
// owner-only policies and no admin policy, so the session client cannot reach
// a row that is not the caller's. A check here would be a second, weaker copy
// of the one that actually holds.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  deleteUserView as deleteWith,
  renameUserView as renameWith,
  saveUserView as saveWith,
  setDefaultUserView as setDefaultWith,
  type ViewActionResult,
} from '@/lib/user-views'
import { parseMdrSearchParams, type RawSearchParams } from '@/lib/mdr'

/**
 * Saves what the register is currently showing, under a name.
 *
 * Takes the URL's search params rather than an MdrQuery: the client component
 * holds the register's state as a query string (the screen IS a URL, 1b.05),
 * and re-parsing it here with the same total parser the page uses means the
 * action cannot be handed a query shape the screen could not have produced.
 */
export async function saveMdrView(name: string, params: RawSearchParams): Promise<ViewActionResult<string>> {
  const supabase = await createClient()
  const result = await saveWith(supabase, { name, query: parseMdrSearchParams(params) })
  if (!result.ok) return result
  revalidatePath('/mdr')
  return { ok: true, data: result.data.id }
}

export async function renameMdrView(id: string, name: string): Promise<ViewActionResult> {
  const supabase = await createClient()
  const result = await renameWith(supabase, id, name)
  if (result.ok) revalidatePath('/mdr')
  return result
}

export async function deleteMdrView(id: string): Promise<ViewActionResult> {
  const supabase = await createClient()
  const result = await deleteWith(supabase, id)
  if (result.ok) revalidatePath('/mdr')
  return result
}

export async function setDefaultMdrView(id: string | null): Promise<ViewActionResult> {
  const supabase = await createClient()
  const result = await setDefaultWith(supabase, id)
  if (result.ok) revalidatePath('/mdr')
  return result
}
