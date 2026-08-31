import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@scl/db'

// Local typed factory: the shared `@scl/db/client` is still untyped
// (docs/deferred-tasks.md d) and DCS must not inherit that path. Once the
// shared factory gets the <Database> generic, this file can be deleted.
export function createClient() {
  // Static member access is required: Next.js inlines NEXT_PUBLIC_* only for
  // literal `process.env.X` expressions.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return createBrowserClient<Database>(url, anonKey)
}
