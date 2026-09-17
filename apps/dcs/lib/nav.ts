// DCS 1a.24: which sidebar entry counts as "where you are".
//
// Pure and exported so it is unit-tested without a Next.js runtime, the same
// split lib/auth-helpers.ts uses for its guards: the component stays a thin
// shell, the decision is testable (docs/03-conventions.md — components stay
// untested, decision logic is unit-tested).
//
// This is presentation only. It decides which link looks current; it has no
// say in who may open it — that is the page guard, and RLS under it.

/**
 * True when `href` is the nav entry the current `pathname` belongs to: an
 * exact match, or anything in the subtree below it.
 *
 * The subtree test appends the separator (`${href}/`) rather than matching a
 * bare string prefix. That is the whole of the logic worth testing, and it
 * carries two cases at once:
 *
 *   - /admin/clients must not claim /admin/clients-archive — a sibling route
 *     that merely starts with the same characters;
 *   - "/" must not claim everything. It needs no special case: "//" is not a
 *     prefix of any real path, so the subtree half is inert for it and the
 *     exact match is all that remains. (An earlier draft special-cased "/"
 *     explicitly; the red-proof run showed removing that branch changed no
 *     behaviour at all, so it was dead code and is gone.)
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
