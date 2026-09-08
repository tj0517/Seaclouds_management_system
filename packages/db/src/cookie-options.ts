import type { CookieOptionsWithName } from '@supabase/ssr'

// 1a.23: TES and DCS share one Supabase project in every deployed
// environment, each on its own subdomain of a common parent domain, so a
// session cookie scoped to that parent domain lets a user cross modules
// without logging in again — aal2 rides along too, since it's a claim on
// the session's own JWT, not a separate per-app flag.
//
// Local development gets no domain override: the default host-scoped cookie
// keeps `localhost:3000` (Timesheet) and `127.0.0.1:3001` (DCS) in separate
// jars. There is no shared parent domain to scope to locally, and sharing one
// jar there stacks every project's local auth cookies together until a
// request trips the header-size limit (HTTP 431) — a bug this repo has
// already hit once with an unrelated cookie pile-up.
//
// Own leaf export (`@scl/db/cookie-options`), not the main `@scl/db` entry:
// this file has no `next/headers` dependency, so `proxy.ts` in both apps can
// import it directly (Edge middleware can't use `@scl/db/server`).
export function getSupabaseCookieOptions(): CookieOptionsWithName | undefined {
  const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
  return domain ? { domain } : undefined
}
