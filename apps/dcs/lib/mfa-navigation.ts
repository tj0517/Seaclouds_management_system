// DCS 1a.25: where /mfa goes once the second factor is accepted.
//
// Lives here, not inline in app/mfa/page.tsx, because the page is a client
// component and this repo's vitest runs in a node environment with no jsdom
// (see vitest.config.ts) — components stay thin wrappers around exported
// decision functions, and this is the decision.
//
// It must be a full document load, not router.push(). A client-side push is
// served out of the Next.js route cache, which at this exact moment holds a
// poisoned entry: the sidebar click that sent the user here resolved, through
// proxy.ts's aal2 gate, to /mfa?next=… — and that is the canonicalUrl cached
// under the TARGET href. Pushing to the target therefore resolves straight
// back to /mfa, the screen never moves, and the button sits on "Verifying…"
// for ever. Three facts, read out of next@16.1.1 (1a.25); re-read in
// next@16.2.12 (1b.09b), where the first two still hold and the third changed
// (see its note):
//
//   - client/components/segment-cache/navigation.js — navigate() reads the
//     requested href from the route cache and, on a fulfilled entry, uses
//     that entry's canonicalUrl without asking the server.
//   - client/components/segment-cache/cache.js — getStaleTimeMs() is
//     `Math.max(staleTimeSeconds, 30) * 1000`, a 30 s floor no staleTimes
//     config can lower, so the entry cannot expire while a presenter reads
//     six digits off their phone.
//   - client/components/router-reducer/reducers/refresh-reducer.js —
//     refresh() calls revalidateEntireCache(): "all refreshes purge the
//     prefetch cache". The original code called it AFTER push(), so it
//     cleared the entry a fraction too late to matter. In next@16.2.12
//     refresh() no longer touches the route cache at all ("we invalidate the
//     segment cache but not the route cache"), so reordering would not help
//     there either; the full load below does not depend on it.
//
// Reordering those two calls was the other candidate and was rejected
// (owner's decision, 2026-09-17): refresh() also starts its own re-fetch of
// the current route, /mfa, and nothing orders that against the push. A full
// load has no such race, and it is what the session change deserves anyway —
// a verified second factor raises the session's AAL, which changes the answer
// every server-side guard gives from here on.

const FALLBACK = '/'

// A base that cannot be anyone's real origin, so "resolved to the base's
// origin" means "the value brought no origin of its own".
const PROBE_ORIGIN = 'https://scl.invalid'

/**
 * Narrows `next` to somewhere inside this app, or gives up and returns '/'.
 *
 * `next` comes off the query string. proxy.ts only ever writes an internal
 * pathname into it, but proxy.ts is not the only way onto /mfa: that route is
 * excluded from the module-access check, so any signed-in user can open
 * /mfa?next=<anything> — or be sent a link to one. Whatever arrives is handed
 * to window.location.assign immediately after a genuine second factor on the
 * genuine domain, which is the moment a redirect is most likely to be
 * trusted, so it is the wrong place to take the query string at its word.
 *
 * Two classes of value have to go: another origin (an open redirect, landing
 * a freshly-2FA'd user on a page primed to ask them to "re-authenticate"),
 * and a javascript:/data: URL, which location.assign() executes in this
 * page's own origin.
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
