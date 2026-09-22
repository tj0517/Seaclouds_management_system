// DCS 1b.09b — deterministic guard for the React hydration-replay bug (#418 on the
// document profile). Run by hand against the LOCAL stack, on a PRODUCTION build; not part
// of CI (docs/03-conventions.md, "Testy przeglądarkowe"). Run it on every Next.js upgrade.
//
// THE BUG (docs/deferred-tasks.md, ccc). The actions <li>s of the current-revision panel
// arrive as separate RSC rows — lazy children of the <ul>. If hydration reaches the <ul>
// before such a row is fulfilled, React suspends there; if the row is then fulfilled while
// React is parked on that fiber, React replays the <ul> without rewinding its hydration
// cursor, claims the <ul> against its own first <li> and reports #418. The React vendored
// by next@16.1.1 has it; react/react#35494 (in next >= 16.2.0) fixes it.
//
// THE SETTING. Naturally that window is well under a millisecond (~1 load in 80). This
// script makes it exact without touching the app or node_modules: an init script (active
// on /documents/* only) holds back the inline RSC chunks that define the <ul>'s lazy rows
// and releases them the SECOND time React reads that <ul>'s firstChild — i.e. after React
// has suspended there once — and defers Next's DOMContentLoaded listener (which closes the
// initial RSC stream) until then. Measured in 1b.09b: next@16.1.1 fails 20 of 20 loads,
// the same build with the upstream fix 0 of 20.
//
// A load counts only if the setting ENGAGED (rows held, released on the second read). A
// run in which it never engaged proves nothing and exits 1 — e.g. if a future Next changes
// how the payload is chunked, this script must be revisited, not trusted.
//
// Prerequisites: as for e2e:profile — `supabase start` + `supabase db reset`, the fixture
// (supabase/fixtures/document_profile.sql), a production build on port 3001, Chromium.
// Then: `pnpm --filter @scl/dcs e2e:hydration-replay`. E2E_ITERATIONS (default 15): each
// iteration signs the DC in and loads the profile twice — at aal1 right after login, and at
// aal2 right after /mfa — so the default is 30 loads. Exit 1 on any #418, any other page
// error, or any load where the setting did not engage.
import { guardLocal, IDS, launch, session, toAal2, BASE } from './support.mjs'

guardLocal()
const ITERATIONS = Number(process.env.E2E_ITERATIONS ?? 15)
const PROFILE = `/documents/${IDS.DOC_A}`

// Runs inside the page before any of its scripts. Plain browser APIs only.
const PROBE = () => {
  if (!location.pathname.startsWith('/documents/')) return
  const state = (window.__hydrationReplay = { ulIds: null, held: 0, released: null })
  const held = []
  const buffered = []
  let consumer = null
  const deferredDcl = []
  const rowsOf = (text) => [...String(text).matchAll(/(?:^|\n)([0-9a-f]+):/g)].map((m) => m[1])
  const forward = (item) => (consumer ? consumer(item) : Array.prototype.push.call(buffered, item))
  const release = (why) => {
    if (state.released) return
    state.released = why
    for (const item of held) forward(item)
    for (const fn of deferredDcl) fn.call(document, new Event('DOMContentLoaded'))
  }
  const shouldHold = (item) => {
    if (state.released || !Array.isArray(item) || item[0] !== 1) return false
    const text = String(item[1])
    if (!state.ulIds) {
      const at = text.indexOf('"$","ul",null,{"className":"grid gap-3')
      if (at >= 0) {
        const end = text.indexOf('\n', at)
        state.ulIds = [...text.slice(at, end < 0 ? undefined : end).matchAll(/"\$L([0-9a-f]+)"/g)].map((m) => m[1])
      }
      return false
    }
    // Once holding starts, everything after is held too: a row may continue into the next chunk.
    return held.length > 0 || rowsOf(text).some((id) => state.ulIds.includes(id))
  }
  Object.defineProperty(buffered, 'push', {
    configurable: true,
    get: () => (...items) => {
      for (const item of items) {
        if (shouldHold(item)) {
          held.push(item)
          state.held = held.length
        } else forward(item)
      }
      return buffered.length
    },
    set: (fn) => {
      consumer = fn
    },
  })
  window.__next_f = buffered

  const addEventListener = EventTarget.prototype.addEventListener
  document.addEventListener = function (type, fn, options) {
    if (type === 'DOMContentLoaded' && !state.released && typeof fn === 'function') {
      deferredDcl.push(fn)
      return
    }
    return addEventListener.call(this, type, fn, options)
  }

  const firstChild = Object.getOwnPropertyDescriptor(Node.prototype, 'firstChild').get
  new MutationObserver((_, observer) => {
    const ul = document.querySelector('aside[aria-label="Current revision"] ul')
    if (!ul) return
    observer.disconnect()
    let reads = 0
    Object.defineProperty(ul, 'firstChild', {
      configurable: true,
      get() {
        reads += 1
        if (reads === 2) release('second-read')
        return firstChild.call(this)
      },
    })
  }).observe(document, { childList: true, subtree: true })
  setTimeout(() => release('fallback'), 3000)
}

const browser = await launch()
const counts = { loads: 0, hydration418: 0, otherErrors: 0, notEngaged: 0 }

async function judge(page, label, errors, from) {
  const mine = errors.slice(from)
  const state = await page.evaluate(() => window.__hydrationReplay ?? null)
  const engaged = !!state && state.held > 0 && state.released === 'second-read'
  const h418 = mine.filter((e) => /Minified React error #418|Hydration failed/.test(e))
  const other = mine.filter((e) => !h418.includes(e))
  counts.loads += 1
  if (h418.length) counts.hydration418 += 1
  if (other.length) counts.otherErrors += 1
  if (!engaged) counts.notEngaged += 1
  const verdict = h418.length ? 'FAIL #418' : other.length ? 'FAIL error' : engaged ? 'ok' : 'NOT ENGAGED'
  console.log(`${verdict.padEnd(12)} ${label}  setting=${JSON.stringify(state)}${other.length ? `  — ${other[0].slice(0, 200)}` : ''}`)
}

for (let i = 1; i <= ITERATIONS; i++) {
  const errors = []
  const { ctx, page } = await session(browser, 'dc.profile@local.test', errors)
  await ctx.addInitScript(PROBE)

  let from = errors.length
  await page.goto(`${BASE}${PROFILE}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await judge(page, `#${i} aal1, first profile load after login`, errors, from)

  // toAal2 lands on the profile through /mfa's full document load.
  from = errors.length
  await toAal2(page, PROFILE)
  await page.waitForTimeout(300)
  await judge(page, `#${i} aal2, profile load right after /mfa`, errors, from)
  await ctx.close()
}
await browser.close()

console.log(
  `\nloads=${counts.loads} with #418=${counts.hydration418} with other errors=${counts.otherErrors} setting not engaged=${counts.notEngaged}`,
)
process.exit(counts.hydration418 || counts.otherErrors || counts.notEngaged ? 1 : 0)
