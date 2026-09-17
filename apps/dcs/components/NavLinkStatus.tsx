'use client'

// DCS 1a.24: the first frame after a click.
//
// Next.js 16's useLinkStatus() reports whether THIS <Link>'s navigation is
// still in flight, and it flips on the click itself — before the server has
// been asked anything. It only works inside a <Link>, which is why this is a
// child component rather than a wrapper: the <Link> elements stay where
// app/(app)/nav.test.ts expects to find them.
//
// Two indicators, one state: a spinner on the item you actually clicked
// (so it is obvious WHICH thing is loading) and an indeterminate bar pinned
// to the top of the viewport (so it is obvious that SOMETHING is). The bar is
// position: fixed, so rendering it from inside the link is not a layout
// concern.
import { useLinkStatus } from 'next/link'
import { Loader2 } from 'lucide-react'

export default function NavLinkStatus() {
  const { pending } = useLinkStatus()
  if (!pending) return null

  return (
    <>
      <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
      <span
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-brand/25"
      >
        <span className="block h-full w-1/2 animate-nav-progress bg-brand-strong" />
      </span>
    </>
  )
}
