import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSupabaseCookieOptions } from '@scl/db/cookie-options'
import { planAuthCookieDomainMigration } from '@scl/db/cookie-migration'

// Must use headers.append, not response.cookies.set: Next's ResponseCookies
// keys its store by name alone, so two same-named writes (the domain-scoped
// copy and the host-only clear) would collapse into one and silently drop
// the other. Set-Cookie is spec-exempt from header-value folding precisely
// so multiple can coexist — see @scl/db/cookie-migration for the full story
// (verified locally: .cookies.set() for both left the browser with neither).
function applyCookieWrites(target: NextResponse, writes: string[]) {
  for (const value of writes) {
    target.headers.append('set-cookie', value)
  }
}

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
    cookieOptions: getSupabaseCookieOptions(),
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

  // 1a.23 follow-up: migrate a pre-existing host-only auth cookie to the
  // shared domain, once per browser — see @scl/db/cookie-migration and the
  // matching comment in apps/timesheet/proxy.ts. In practice this is a
  // no-op for DCS today: its production Vercel env pointed at scl-dev
  // (a different Supabase project, so a different cookie name entirely)
  // until this same PR repointed it, so there are no pre-existing
  // `sb-tfbzivfsqsgebegcvfah-auth-token` cookies here to migrate. Built
  // anyway, symmetrically, since the next repointing (dev/staging cutovers,
  // or a future project migration) would create exactly this problem again.
  const cookieDomain = getSupabaseCookieOptions()?.domain
  const migrationWrites = user && cookieDomain
    ? planAuthCookieDomainMigration(request.cookies.getAll(), cookieDomain)
    : null
  if (migrationWrites) {
    applyCookieWrites(response, migrationWrites)
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
        const mfaRedirect = NextResponse.redirect(mfaUrl)
        if (migrationWrites) applyCookieWrites(mfaRedirect, migrationWrites)
        return mfaRedirect
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
