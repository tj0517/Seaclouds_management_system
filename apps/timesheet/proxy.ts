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

export async function proxy(request: NextRequest) {
  // 1. Tworzymy odpowiedź domyślną
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // 2. Konfigurujemy klienta Supabase
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  )

  // 3. Pobieramy użytkownika (tylko RAZ)
  // UWAGA: To wywołanie odświeża też token w ciasteczkach jeśli trzeba
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (e: any) {
    // Invalid/corrupted JWT (e.g. Safari cookie truncation) — clear auth cookies and redirect to login
    if (e?.message?.includes('JWS') || e?.message?.includes('Compact') || e?.code === 'bad_jwt') {
      const loginUrl = new URL('/login', request.url)
      const redirectResponse = NextResponse.redirect(loginUrl)
      // Delete all Supabase auth cookies
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.includes('auth-token')) {
          redirectResponse.cookies.delete(cookie.name)
        }
      }
      return redirectResponse
    }
  }

  // 4. Ochrona tras
  // Jeśli nie ma usera I nie jesteśmy na stronie logowania -> przekieruj
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
     return NextResponse.redirect(new URL('/login', request.url))
  }

  // 1a.23 follow-up: migrate a pre-existing host-only auth cookie to the
  // shared domain, once per browser. See @scl/db/cookie-migration for why
  // this can't just fall out of setting cookieOptions.domain: it only
  // controls where a NEW write lands, so a still-valid old session would
  // otherwise sit host-only until its next natural token refresh — and even
  // then, both cookies (same name, different Domain) would briefly coexist.
  // Applied to `response` here so the normal-return path carries it, and
  // separately at the /mfa redirect below, since that returns a different
  // NextResponse — cookies set on `response` don't travel onto it.
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

  // 5. Zwracamy odpowiedź (z ewentualnie odświeżonymi ciasteczkami)
  return response
}

// 6. KLUCZOWY ELEMENT - MATCHER
// To naprawia błąd "Unexpected token <"
export const config = {
  matcher: [
    /*
     * Uruchamiaj middleware dla wszystkich ścieżek OPRÓCZ:
     * - api (trasy API)
     * - _next/static (pliki statyczne JS/CSS)
     * - _next/image (obrazy)
     * - favicon.ico (ikona)
     * - plików z rozszerzeniami (png, jpg, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
