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
// for ever. Three facts, each read out of the installed next@16.1.1:
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
//     cleared the entry a fraction too late to matter.
//
// Reordering those two calls was the other candidate and was rejected
// (owner's decision, 2026-09-17): refresh() also starts its own re-fetch of
// the current route, /mfa, and nothing orders that against the push. A full
// load has no such race, and it is what the session change deserves anyway —
// a verified second factor raises the session's AAL, which changes the answer
// every server-side guard gives from here on.

export type PostVerifyNavigation = {
  /** window.location.assign — a full document load, no client cache involved. */
  assign: (href: string) => void
}

export function navigateAfterMfaVerify(nav: PostVerifyNavigation, next: string): void {
  nav.assign(next)
}
