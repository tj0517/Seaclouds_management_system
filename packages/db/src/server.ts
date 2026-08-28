import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { Database } from './database'

export async function createClient() {
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  return createServerClient<Database>(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
          }
        },
      },
    }
  )
}

/**
 * Safe wrapper for getUser() that handles corrupted JWS tokens (e.g. Safari cookie truncation).
 * Clears auth cookies and redirects to login on JWS errors.
 */
export async function safeGetUser() {
  const supabase = await createClient()
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return { supabase, user }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- moved verbatim from apps/timesheet; error shape comes from supabase-js internals
  } catch (e: any) {
    if (e?.message?.includes('JWS') || e?.message?.includes('Compact') || e?.code === 'bad_jwt') {
      const cookieStore = await cookies()
      for (const cookie of cookieStore.getAll()) {
        if (cookie.name.includes('auth-token')) {
          cookieStore.delete(cookie.name)
        }
      }
      redirect('/login')
    }
    throw e
  }
}
