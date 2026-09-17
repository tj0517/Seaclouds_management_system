'use client'

// DCS 1a.24: what "saving" means on a DCS screen.
//
// Every action component here already showed a pending label and disabled its
// button. Two things were still wrong, and both are what made the app feel
// like it had ignored the click:
//
//  1. Pending ended too early. The handlers did `setSaving(false)` and THEN
//     `router.refresh()`. The refresh is the slow half — it re-renders the
//     whole RSC tree on the server, measured at 400-470ms against scl-dev —
//     and during it the button had already snapped back to "Save" and the
//     dialog had already closed. The screen sat there unchanged, looking
//     broken. Holding the refresh in a transition keeps `pending` true until
//     the new data is actually on screen.
//
//  2. `disabled` could not stop a double submit on its own. It is React
//     state set inside an async handler, so it is not in the DOM until after
//     the first await; two fast clicks both got through. The latch in
//     lib/single-flight.ts flips synchronously, inside the click, and is
//     unit-tested there.
//
// Nothing here changes what an action does or who may call it. The server
// actions still re-check every guard, and RLS is still underneath them.
import { useCallback, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SKIPPED, singleFlight, type Skipped } from '@/lib/single-flight'

type Action<R> = () => Promise<R>

export type PendingAction = {
  /** Runs `action` unless one is already in flight, in which case: SKIPPED. */
  run: <R>(action: Action<R>) => Promise<R | Skipped>
  /** Re-reads the server tree, keeping `pending` true until it lands. */
  refresh: () => void
  /** True from the click until the refreshed page is rendered. */
  pending: boolean
}

export function usePendingAction(): PendingAction {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [refreshing, startRefresh] = useTransition()

  // One latch per mounted component, created once and never re-created — a
  // new latch on re-render would be no latch at all. Initialised lazily on
  // first use so the ref never has to be asserted non-null.
  const gate = useRef<((action: Action<unknown>) => Promise<unknown>) | null>(null)

  const run = useCallback(async <R,>(action: Action<R>): Promise<R | Skipped> => {
    const guarded = (gate.current ??= singleFlight((queued: Action<unknown>) => queued()))
    // `entered` is what keeps a refused second click from clearing the
    // pending state that belongs to the first one still running.
    let entered = false
    const result = await guarded(() => {
      entered = true
      setRunning(true)
      return action()
    })
    if (entered) setRunning(false)
    return result as R | Skipped
  }, [])

  const refresh = useCallback(() => {
    startRefresh(() => router.refresh())
  }, [router])

  return { run, refresh, pending: running || refreshing }
}

export { SKIPPED }
export type { Skipped }
