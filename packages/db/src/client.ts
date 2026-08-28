import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // Static member access is required: Next.js inlines NEXT_PUBLIC_* only for
  // literal `process.env.X` expressions, so dynamic lookup would be undefined
  // in browser bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return createBrowserClient(url, anonKey)
}
