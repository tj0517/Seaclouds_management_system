'use server'

// DCS 1a.16: clients admin screen server actions. Logic lives in
// lib/clients-admin.ts (framework-agnostic, unit tested); this file binds it
// to the session client and revalidates the one page that reads
// public.clients for the admin screen. Same split as
// app/data/actions/dictionaries.ts.
import { revalidatePath } from 'next/cache'
import { createClient as createDbClient } from '@scl/db/server'
import {
  createClient as createWith,
  updateClient as updateWith,
  setClientActive as setActiveWith,
  type ActionResult,
  type ClientRow,
  type CreateClientInput,
  type SetClientActiveInput,
  type UpdateClientInput,
} from '@/lib/clients-admin'

export async function createClient(input: CreateClientInput): Promise<ActionResult<ClientRow>> {
  const supabase = await createDbClient()
  const result = await createWith(supabase, input)
  if (result.ok) revalidatePath('/admin/clients')
  return result
}

export async function updateClient(input: UpdateClientInput): Promise<ActionResult<ClientRow>> {
  const supabase = await createDbClient()
  const result = await updateWith(supabase, input)
  if (result.ok) revalidatePath('/admin/clients')
  return result
}

export async function setClientActive(
  input: SetClientActiveInput,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  const supabase = await createDbClient()
  const result = await setActiveWith(supabase, input)
  if (result.ok) revalidatePath('/admin/clients')
  return result
}
