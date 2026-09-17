// DCS 1a.25: the presenter's path through demo step 1, end to end in one
// browsing context — fresh login, sidebar click, /mfa, code, target screen.
//
// Why a model and not a browser: vitest here runs in node with no jsdom
// (vitest.config.ts), and the bug is not in any component's markup. It lives
// in the interaction between three things that a unit test CAN hold at once —
// proxy.ts's aal2 gate, the Next.js client route cache, and the order of the
// two navigation calls /mfa makes after a successful verify. The model below
// is deliberately narrow and every rule in it is quoted from the source of
// the two things it models. The walk on the real build is a separate,
// human-performed verification (docs/deferred-tasks.md (z)).
import { beforeEach, describe, expect, it } from 'vitest'
import { navigateAfterMfaVerify, type PostVerifyNavigation } from './mfa-navigation'
import { resolveMfaFactorState, type MfaFactor } from './mfa-factor-state'

// --- the server side: proxy.ts's gate, transcribed --------------------------
//
// From apps/dcs/proxy.ts: a signed-in admin or DC hitting /admin/* without an
// aal2 session is redirected to /mfa with the requested pathname in `next`.
// Nothing else in that file matters to this walk, and nothing here changes
// the rule — this is a copy for the model to redirect against, not a
// replacement for the gate.
type Aal = 'aal1' | 'aal2'

function proxy(pathname: string, session: { isAdminOrDc: boolean; aal: Aal }): string {
  if (
    session.isAdminOrDc &&
    pathname.startsWith('/admin') &&
    !pathname.startsWith('/mfa') &&
    session.aal !== 'aal2'
  ) {
    return `/mfa?next=${pathname}`
  }
  return pathname
}

// --- the client side: the Next.js 16.1.1 route cache, narrowed --------------
//
// Three rules, each read out of the installed next@16.1.1:
//
//  (1) segment-cache/navigation.js, navigate(): looks the requested href up in
//      the route cache and, on a Fulfilled entry, navigates to that entry's
//      `canonicalUrl` without asking the server again.
//  (2) segment-cache/cache.js, getStaleTimeMs(): `Math.max(s, 30) * 1000` — a
//      30-second floor on every entry, which no staleTimes config can lower.
//      That is longer than it takes to read six digits off a phone.
//  (3) router-reducer/reducers/refresh-reducer.js, refreshReducer(): calls
//      revalidateEntireCache() — "all refreshes purge the prefetch cache".
//
// A full document load (window.location.assign) throws the whole client
// router away with the document, so it is modelled as an empty cache.
const ROUTE_CACHE_FLOOR_MS = 30_000

class Context {
  location = 'about:blank'
  /** requested href -> where the server said that href actually resolves to */
  private cache = new Map<string, { canonicalUrl: string; storedAt: number }>()
  private clock = 0
  /** every time the user is put in front of the code form */
  codePrompts = 0
  /** requests that actually reached the server (and therefore the gate) */
  serverHits = 0

  constructor(private session: { isAdminOrDc: boolean; aal: Aal }) {}

  private arrive(at: string) {
    this.location = at
    if (at.startsWith('/mfa')) this.codePrompts += 1
  }

  private ask(href: string): string {
    this.serverHits += 1
    const resolved = proxy(href, this.session)
    this.cache.set(href, { canonicalUrl: resolved, storedAt: this.clock })
    return resolved
  }

  /** Time spent typing the code. Entries younger than the floor stay fresh. */
  wait(ms: number) {
    this.clock += ms
  }

  /** A full document load: no client router, no cache, straight to the gate. */
  load(href: string) {
    this.cache.clear()
    this.arrive(this.ask(href))
  }

  /** A <Link> click — rule (1) and (2). */
  click(href: string) {
    const hit = this.cache.get(href)
    if (hit && this.clock - hit.storedAt < ROUTE_CACHE_FLOOR_MS) {
      this.arrive(hit.canonicalUrl)
      return
    }
    this.arrive(this.ask(href))
  }

  /** What /mfa is handed after a successful verify. */
  navigator(): PostVerifyNavigation {
    return { assign: (href) => this.load(href) }
  }

  /** challengeAndVerify() came back 200 and GoTrue raised the session. */
  verifySucceeds() {
    this.session.aal = 'aal2'
  }
}

function nextParam(location: string): string {
  const query = location.split('?')[1]
  return new URLSearchParams(query ?? '').get('next') ?? '/'
}

// --- the walk ---------------------------------------------------------------
//
// The three ways an admin can arrive at /mfa. They differ only in what
// listFactors() returns on mount — the navigation after a successful verify is
// the same code path for all three, which is exactly why all three are walked.
const VERIFIED: MfaFactor[] = [
  { id: 'f-verified', status: 'verified', factor_type: 'totp', created_at: '2026-09-08T10:00:00Z' },
]
const NONE: MfaFactor[] = []
const UNVERIFIED: MfaFactor[] = [
  // The factor sitting on dcs1a14-member on scl-dev, see deferred-tasks (mm).
  { id: 'f-pending', status: 'unverified', factor_type: 'totp', created_at: '2026-09-17T08:36:39Z' },
]

describe.each([
  ['a verified factor (the presenter)', VERIFIED, 'verified' as const],
  ['no factors at all (enrolment)', NONE, 'new' as const],
  ['an unverified factor left behind (pending)', UNVERIFIED, 'pending' as const],
])('demo step 1, entering /mfa with %s', (_label, factors, expectedMode) => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context({ isAdminOrDc: true, aal: 'aal1' })
  })

  it('reaches /admin/dictionaries on one click and one code', () => {
    // 1. Fresh login. The project list is not gated, so no prompt yet.
    ctx.load('/login')
    ctx.click('/')
    expect(ctx.location).toBe('/')
    expect(ctx.codePrompts).toBe(0)

    // 2. The sidebar click. proxy.ts sends an aal1 admin to the gate.
    ctx.click('/admin/dictionaries')
    expect(ctx.location).toBe('/mfa?next=/admin/dictionaries')
    expect(ctx.codePrompts).toBe(1)

    // 3. /mfa mounts and decides what to show.
    expect(resolveMfaFactorState(factors).mode).toBe(expectedMode)

    // 4. The presenter reads the code off their phone and submits it.
    const next = nextParam(ctx.location)
    ctx.wait(12_000)
    ctx.verifySucceeds()
    const hitsBefore = ctx.serverHits
    navigateAfterMfaVerify(ctx.navigator(), next)

    // 5. They are on the dictionaries screen, and were asked for a code once.
    expect(ctx.location).toBe('/admin/dictionaries')
    expect(ctx.codePrompts).toBe(1)

    // And they got there by asking the server, not by replaying the cached
    // answer from step 2 — which is the whole difference between this working
    // and the button sitting on "Verifying…". A client-side push would score
    // zero here even on the runs where it happens to land right.
    expect(ctx.serverHits).toBeGreaterThan(hitsBefore)
  })

  it('does not depend on the route cache entry having expired', () => {
    ctx.load('/login')
    ctx.click('/admin/dictionaries')
    const next = nextParam(ctx.location)

    // A code read fast. Well inside the 30 s floor, so the poisoned entry for
    // /admin/dictionaries is still fresh when the navigation happens.
    ctx.wait(3_000)
    ctx.verifySucceeds()
    navigateAfterMfaVerify(ctx.navigator(), next)

    expect(ctx.location).toBe('/admin/dictionaries')
  })
})
