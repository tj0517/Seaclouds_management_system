import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Corrupted-JWT detection (e.g. Safari cookie truncation) — same failure mode
// the Timesheet proxy handles; the error shape comes from supabase-js internals.
function isCorruptedJwtError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { message, code } = error as { message?: unknown; code?: unknown }
  return (
    (typeof message === 'string' &&
      (message.includes('JWS') || message.includes('Compact'))) ||
    code === 'bad_jwt'
  )
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // getUser() also refreshes the token in cookies when needed.
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (error) {
    if (isCorruptedJwtError(error)) {
      const redirectResponse = NextResponse.redirect(new URL('/login', request.url))
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.includes('auth-token')) {
          redirectResponse.cookies.delete(cookie.name)
        }
      }
      return redirectResponse
    }
    throw error
  }

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // DCS 1a.11 / O-14: admin and DC routes require a verified second factor.
  // This is UX only — the guarantee that survives a direct API call lives in
  // the aal2 conjunct on the dcs.dictionaries RLS policies (see
  // supabase/migrations/20260904160000_dictionaries_dc_aal2.sql). Regular
  // employees never reach this check.
  if (
    user &&
    request.nextUrl.pathname.startsWith('/admin') &&
    !request.nextUrl.pathname.startsWith('/mfa')
  ) {
    const [{ data: profile }, { data: dcRoles }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      supabase.schema('dcs').from('project_roles').select('role').eq('user_id', user.id).eq('role', 'dc').limit(1),
    ])
    const isAdmin = profile?.role === 'admin'
    const isDocController = (dcRoles?.length ?? 0) > 0

    if (isAdmin || isDocController) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.currentLevel !== 'aal2') {
        const mfaUrl = new URL('/mfa', request.url)
        mfaUrl.searchParams.set('next', request.nextUrl.pathname)
        return NextResponse.redirect(mfaUrl)
      }
    }
  }

  return response
}

export const config = {
  // Everything except static assets and files with extensions.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
