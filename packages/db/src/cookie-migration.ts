// 1a.23 follow-up: existing sessions predate the shared-domain cookie and
// hold a host-only `sb-<ref>-auth-token` (no Domain attribute) scoped to
// app.seaclouds.eu. Once NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is set, the SAME
// cookie name gets written again on refresh — but with Domain=.seaclouds.eu.
// A browser identifies a cookie by (name, domain, path), so that is a
// SEPARATE cookie, not an overwrite of the old one. Left alone, a still-
// active user ends up holding two cookies of the same name at once, and
// which one a given request's Cookie header resolves to on the server is an
// implementation-specific ordering detail, not something to depend on — the
// exact "random logout / stale session" failure mode @supabase/ssr's own
// docs warn a broken cookie config produces, except backwards here: a
// request could intermittently authenticate with an already-rotated,
// invalid refresh token instead of the live one.
//
// This is the fix: on an authenticated request, once per browser, copy the
// existing auth cookie value(s) byte-for-byte to a new write carrying the
// shared domain, and explicitly expire the host-only original in the same
// response. The expiry MUST be issued with no domain attribute — a browser
// matches Set-Cookie deletion by (name, domain, path); attaching the new
// domain to the expiry targets the cookie just written instead of the one
// being retired.
//
// This returns raw `Set-Cookie` header VALUES, not {name,value,options}
// triples for `response.cookies.set()` — on purpose, verified the hard way
// locally (see the PR description / verification section): Next's
// `ResponseCookies` keys its internal store by cookie NAME alone, so two
// `.set()` calls for the same name — one with `domain`, one without —
// collapse into one, and whichever call happened to run last wins outright.
// In practice that meant the host-only clear silently discarded the
// domain-scoped write it was supposed to run alongside, leaving the browser
// with NEITHER cookie. `Headers.append('set-cookie', ...)` is exempt from
// that collapsing (Set-Cookie is spec-carved-out from header value folding,
// specifically so more than one can coexist), so the call site must use
// `response.headers.append('set-cookie', value)` for every string this
// returns, never `response.cookies.set(...)`.
//
// Guarded by its own marker cookie (host-only, harmless either way) so a
// once-migrated browser skips this on every subsequent request rather than
// re-planning a no-op write on each one.
//
// Pure function, no Next.js/Edge-runtime dependency: takes whatever
// `request.cookies.getAll()` already returns, hands back the header values
// to append. Own leaf export (`@scl/db/cookie-migration`), matching
// cookie-options.ts and module-access.ts, so apps/*/proxy.ts (Edge) can use
// it without pulling in `next/headers`.
const AUTH_COOKIE_PATTERN = /^sb-.*-auth-token(\.\d+)?$/
const MIGRATION_MARKER_NAME = 'sb-auth-cookie-domain-migrated'

// A year-scale maxAge, matching @supabase/ssr's own default (400 days) —
// not imported from there, since DEFAULT_COOKIE_OPTIONS isn't part of its
// public API surface.
const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

export interface CookieLike {
  name: string
  value: string
}

function serializeCookie(
  name: string,
  value: string,
  options: { domain?: string; path: string; sameSite?: 'Lax' | 'Strict' | 'None'; httpOnly?: boolean; maxAge?: number; expires?: Date },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.domain) parts.push(`Domain=${options.domain}`)
  parts.push(`Path=${options.path}`)
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options.httpOnly) parts.push('HttpOnly')
  // No forced `Secure`: matches @supabase/ssr's own DEFAULT_COOKIE_OPTIONS,
  // which doesn't set it either — kept consistent with every other cookie
  // this codebase writes, and lets this run over plain http in local/dev
  // reproductions of the migration (NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=localhost).
  return parts.join('; ')
}

// Returns the raw Set-Cookie header values to append, or null when this
// browser is already migrated (marker present) — nothing to do. Called
// only when a shared domain is actually configured; with no domain there
// is nothing to migrate host-only cookies TO, so the call site skips this
// entirely in local dev.
export function planAuthCookieDomainMigration(cookies: CookieLike[], domain: string): string[] | null {
  if (cookies.some((c) => c.name === MIGRATION_MARKER_NAME)) {
    return null
  }

  const writes: string[] = []

  for (const cookie of cookies) {
    if (!AUTH_COOKIE_PATTERN.test(cookie.name)) continue

    writes.push(
      serializeCookie(cookie.name, cookie.value, {
        domain,
        path: '/',
        sameSite: 'Lax',
        httpOnly: false,
        maxAge: AUTH_COOKIE_MAX_AGE,
      }),
    )
    writes.push(
      serializeCookie(cookie.name, '', {
        // No domain: this must match the host-only cookie's identity, not
        // the domain-scoped one just queued above.
        path: '/',
        maxAge: 0,
        expires: new Date(0),
      }),
    )
  }

  writes.push(
    serializeCookie(MIGRATION_MARKER_NAME, '1', { path: '/', maxAge: AUTH_COOKIE_MAX_AGE }),
  )

  return writes
}
