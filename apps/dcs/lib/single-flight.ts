// DCS 1a.24: one action at a time, decided synchronously.
//
// Every save button in this app already renders `disabled={saving}`. That is
// not enough on its own to stop a double submit, and the gap is a real one:
// the handlers are async, so between the first click and React committing
// `disabled` to the DOM there is at least one microtask in which the button
// is still live. A fast double-click, an Enter held down, or a flaky trackpad
// lands two calls on the server action — and setProjectRoles /
// createProjectMdr are not idempotent.
//
// A ref-like latch closes exactly that window because it flips during the
// click handler itself, before any await. The disabled attribute is still
// worth having — it is what the user SEES — but this is what actually holds.
//
// Pure and dependency-free so vitest (node-only, no jsdom — see
// vitest.config.ts) can test it directly, the same split lib/nav.ts and
// lib/auth-helpers.ts use.

/** What a wrapped call returns when it was refused because one is running. */
export const SKIPPED = Symbol('single-flight:skipped')
export type Skipped = typeof SKIPPED

/**
 * Wraps `fn` so that, while one call is still pending, further calls return
 * SKIPPED without invoking it. The latch is released when the call settles,
 * rejection included — a failed save must be retryable.
 */
export function singleFlight<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | Skipped> {
  let running = false
  return async (...args: A) => {
    if (running) return SKIPPED
    running = true
    try {
      return await fn(...args)
    } finally {
      running = false
    }
  }
}
