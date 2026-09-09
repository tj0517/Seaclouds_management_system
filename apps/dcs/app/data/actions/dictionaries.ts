'use server'

// DCS 1a.15: dictionaries admin screen server actions. Logic lives in
// lib/dictionaries-admin.ts (framework-agnostic, unit tested); this file
// binds it to the session client and revalidates the one page that reads
// dcs.dictionaries for the admin screen.
import { revalidatePath } from 'next/cache'
import { createClient } from '@scl/db/server'
import {
  createDictionaryEntry as createWith,
  updateDictionaryEntry as updateWith,
  setDictionaryEntryActive as setActiveWith,
  type ActionResult,
  type CreateDictionaryEntryInput,
  type SetDictionaryEntryActiveInput,
  type UpdateDictionaryEntryInput,
} from '@/lib/dictionaries-admin'
import type { DictionaryRow } from '@/lib/dictionaries'

export async function createDictionaryEntry(
  input: CreateDictionaryEntryInput,
): Promise<ActionResult<DictionaryRow>> {
  const supabase = await createClient()
  const result = await createWith(supabase, input)
  if (result.ok) revalidatePath('/admin/dictionaries')
  return result
}

export async function updateDictionaryEntry(
  input: UpdateDictionaryEntryInput,
): Promise<ActionResult<DictionaryRow>> {
  const supabase = await createClient()
  const result = await updateWith(supabase, input)
  if (result.ok) revalidatePath('/admin/dictionaries')
  return result
}

export async function setDictionaryEntryActive(
  input: SetDictionaryEntryActiveInput,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  const supabase = await createClient()
  const result = await setActiveWith(supabase, input)
  if (result.ok) revalidatePath('/admin/dictionaries')
  return result
}
