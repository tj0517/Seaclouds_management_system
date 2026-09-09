// DCS 1a.14b: name directory for DCS screens, backed by the SECURITY DEFINER
// function public.dcs_profile_directory() (migration 20260909130753) — never
// a profiles RLS policy, because RLS is row-level and cannot hide
// rate_hourly/rate_daily from a co-member the way this function's narrow
// return shape (id, full_name) does by construction. See the migration
// comment and the matching ADR for the full reasoning.
//
// Same split as lib/project-roles.ts: takes any typed Supabase client, no
// Next.js import, so this runs from an RSC, a server action, or a Vitest
// test alike.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@scl/db'

export type DirectoryEntry = { id: string; full_name: string | null }

type DbClient = SupabaseClient<Database>

/**
 * Calls dcs_profile_directory() and never throws: a read failure here would
 * otherwise take down the whole team page or project list with it. Callers
 * degrade to an empty directory on error (same shape as
 * lib/module-permissions.ts's fetchMyModuleAccess) — the caller decides how
 * to surface that (a name falls back to a truncated id; a picker just has
 * fewer/no candidates), logged here so a real outage isn't silent.
 */
export async function getProfileDirectory(
  supabase: DbClient,
): Promise<{ entries: DirectoryEntry[]; degraded: boolean }> {
  const { data, error } = await supabase.rpc('dcs_profile_directory')
  if (error) {
    console.error('getProfileDirectory: dcs_profile_directory() failed, degrading to an empty directory', error)
    return { entries: [], degraded: true }
  }
  return { entries: data ?? [], degraded: false }
}

/** Directory entries minus a set of ids — the "add member" picker's candidate list. */
export function excludeIds(entries: readonly DirectoryEntry[], ids: Iterable<string>): DirectoryEntry[] {
  const exclude = new Set(ids)
  return entries.filter((entry) => !exclude.has(entry.id))
}
