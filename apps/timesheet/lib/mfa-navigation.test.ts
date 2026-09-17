// DCS 1a.26: what a successful second factor on Timesheet is allowed to
// navigate to.
//
// `next` arrives from the query string. apps/timesheet/proxy.ts only ever
// writes an internal pathname into it, but proxy.ts is not the only way onto
// /mfa: that route is excluded from the aal2 gate's own check (it has to be,
// or the redirect would loop), so any signed-in user can open
// /mfa?next=<anything> directly, and a link to one can be sent to them.
//
// Whatever ends up here is handed to router.push() immediately after a
// genuine second factor on the genuine domain — app.seaclouds.eu, the
// production app — which is exactly the moment a redirect is most likely to
// be trusted. And router.push() is not a safe sink for it: in the installed
// next@16.1.1, dispatchNavigateAction() parses the href against
// location.href, isExternalURL() compares only `url.origin !==
// window.location.origin`, and navigateReducer() hands anything external to
// handleExternalUrl() -> pushRef.mpaNavigation -> `location.assign(
// canonicalUrl)` in app-router.js. A javascript: or data: URL has an opaque
// origin, so it takes that same branch and reaches location.assign()
// verbatim — the identical sink apps/dcs/lib/mfa-navigation.ts guards.
import { describe, expect, it } from 'vitest'
import { safeNextPath } from './mfa-navigation'

describe('the destination a successful verify is allowed to go to', () => {
  describe.each([
    ['an absolute http(s) URL', 'https://evil.example/login'],
    ['a scheme-relative URL', '//evil.example/login'],
    // The URL parser folds "\" to "/" for http(s), so these are the same
    // attack wearing a different hat — and they survive a naive
    // startsWith('/') check, which is why they are here.
    ['a backslash-smuggled host', '/\\evil.example/login'],
    ['a mixed slash/backslash host', '/\\/evil.example/login'],
    // location.assign() — which router.push() reaches for these, see above —
    // runs a javascript: URL in the page's own origin.
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    // The URL parser strips leading whitespace, so this becomes //evil.example.
    ['a space-prefixed scheme-relative URL', ' //evil.example/login'],
    // ...and strips tab/LF/CR from anywhere, so this becomes //evil.example.
    ['a newline-smuggled host', '/\n/evil.example/login'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { toString: () => 'https://evil.example' }],
  ])('refuses %s', (_label, hostile) => {
    it('and goes to / instead', () => {
      expect(safeNextPath(hostile)).toBe('/')
    })
  })

  describe.each([
    ['the path the gate actually writes', '/admin/users'],
    ['the app root', '/'],
    ['a path with a query and a hash', '/admin/earnings/u-1?month=2026-09#status'],
    ['a path that merely mentions a scheme', '/admin/projects?note=https://example.com'],
  ])('allows %s', (_label, benign) => {
    it('and goes there unchanged', () => {
      expect(safeNextPath(benign)).toBe(benign)
    })
  })
})
