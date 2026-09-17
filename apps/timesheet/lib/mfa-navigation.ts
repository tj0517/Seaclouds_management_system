// DCS 1a.26: where /mfa is allowed to go once the second factor is accepted.
//
// A deliberate copy of `safeNextPath` from apps/dcs/lib/mfa-navigation.ts,
// not a shared export (owner's decision, 2026-09-17): `mfa-factor-state.ts`
// is already duplicated per app, and a leaf on @scl/db would make a
// production Timesheet fix wait on a package both apps consume.
//
// Only the guard is copied. DCS's `navigateAfterMfaVerify` — the full
// document load that unfroze its demo step 1 — is NOT here: whether
// Timesheet's aal2 gate is reached by a client-side click (and so hits the
// same poisoned route-cache entry) is still unmeasured, and is a separate
// task. See docs/deferred-tasks.md (nn), first bullet, defect 1.
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
