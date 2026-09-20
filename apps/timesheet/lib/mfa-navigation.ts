// DCS 1a.26: where /mfa is allowed to go once the second factor is accepted.
//
// A deliberate copy of `safeNextPath` from apps/dcs/lib/mfa-navigation.ts,
// not a shared export (owner's decision, 2026-09-17): `mfa-factor-state.ts`
// is already duplicated per app, and a leaf on @scl/db would make a
// production Timesheet fix wait on a package both apps consume.
//
// DCS 1a.25b added `navigateAfterMfaVerify`, the full document load that
// unfroze DCS's demo step 1 (1a.25). It must be a full load, not router.push():
// the click on the "Admin" link that sent the user here left a route-cache
// entry under the TARGET href whose canonicalUrl is /mfa?next=…, because that
// is where proxy.ts's aal2 gate resolved it — so pushing to the target
// resolves straight back to /mfa and the button sits on "Verifying…" for
// ever. Measured on a production build of this app (docs/deferred-tasks.md
// (ww)): after a correct code the browser made no request for /admin at all.
// The mechanism, read out of next@16.1.1, is written up in full in
// apps/dcs/lib/mfa-navigation.ts and is not repeated here.
//
// Lives in lib/ rather than inline in app/mfa/page.tsx because that page is
// a client component and this repo's vitest runs in a node environment with
// no jsdom (vitest.config.ts) — components stay thin wrappers around
// exported decision functions, and this is the decision.

const FALLBACK = '/'

// A base that cannot be anyone's real origin, so "resolved to the base's
// origin" means "the value brought no origin of its own".
const PROBE_ORIGIN = 'https://scl.invalid'

/**
 * Narrows `next` to somewhere inside this app, or gives up and returns '/'.
 *
 * `next` comes off the query string. proxy.ts only ever writes an internal
 * pathname into it, but proxy.ts is not the only way onto /mfa: that route is
 * excluded from the aal2 gate's own check, so any signed-in user can open
 * /mfa?next=<anything> — or be sent a link to one. Whatever arrives is handed
 * to the post-verify navigation immediately after a genuine second factor on
 * the genuine domain, which is the moment a redirect is most likely to be
 * trusted, so it is the wrong place to take the query string at its word.
 *
 * Two classes of value have to go: another origin (an open redirect, landing
 * a freshly-2FA'd user on a page primed to ask them to "re-authenticate"),
 * and a javascript:/data: URL. Both reach the same sink here as in DCS even
 * though this page navigates with router.push() rather than
 * window.location.assign(): in the installed next@16.1.1,
 * dispatchNavigateAction() parses the href against location.href,
 * isExternalURL() is `url.origin !== window.location.origin`, and
 * navigateReducer() sends anything external to handleExternalUrl(), which
 * sets pushRef.mpaNavigation and lands on `location.assign(canonicalUrl)` in
 * app-router.js. An opaque-origin URL is "external", so javascript: and
 * data: take that branch too.
 *
 * The parse is the authority rather than string matching, because the URL
 * parser normalises before it resolves — it folds "\" to "/" for http(s) and
 * strips tab, LF, CR and leading whitespace anywhere in the input. So
 * "/\evil.example", " //evil.example" and "/\n/evil.example" all reach the
 * network as another host while passing a naive startsWith('/') check.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next === '') return FALLBACK
  // Cheap, readable first pass: a scheme or a leading space never survives.
  if (!next.startsWith('/')) return FALLBACK
  let url: URL
  try {
    url = new URL(next, PROBE_ORIGIN)
  } catch {
    return FALLBACK
  }
  if (url.origin !== PROBE_ORIGIN) return FALLBACK
  // Return what was PARSED, not what arrived, so the value that was judged is
  // the value that gets navigated to.
  return url.pathname + url.search + url.hash
}

export type PostVerifyNavigation = {
  /** window.location.assign — a full document load, no client cache involved. */
  assign: (href: string) => void
}

export function navigateAfterMfaVerify(nav: PostVerifyNavigation, next: string): void {
  nav.assign(safeNextPath(next))
}
