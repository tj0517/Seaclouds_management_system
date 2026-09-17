'use client'

// DCS 1a.24: marks the current sidebar entry, and closes the mobile drawer
// when one is picked.
//
// It takes the <Link> elements as children and clones them to add the active
// styling, rather than rendering them itself from a list of hrefs. That shape
// is deliberate: app/(app)/nav.test.ts imports the real DcsSidebar, calls it
// as a plain function and asserts the next/link elements in its own returned
// tree are exactly ['/', '/admin/dictionaries', '/admin/clients']. Building
// the links here instead would hide them behind a client boundary the test
// cannot see through, and DcsSidebar would have to become a client component
// to know the pathname. Children-in, cloned-out keeps the sidebar a hook-free
// server component and the test passing unedited.
//
// Visibility is not decided here. Which links exist is settled in
// app/(app)/layout.tsx by canOpenAdminScreens(); this only paints them.
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useCloseDrawer } from '@/components/AppShell'
import { cn } from '@/lib/utils'
import { isNavItemActive } from '@/lib/nav'

type LinkLike = ReactElement<{ href?: string; className?: string }>

const BASE =
  'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-ring'
const IDLE = 'text-muted-foreground hover:bg-secondary hover:text-foreground'
// The brand cyan earns its keep here: a 2px marker on the active item, never
// as text (it fails contrast on white — see app/globals.css).
const ACTIVE =
  'bg-accent text-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 ' +
  'before:rounded-full before:bg-brand'

export default function SidebarNav({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const closeDrawer = useCloseDrawer()

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4" aria-label="DCS sections">
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child
        const link = child as LinkLike
        const href = link.props.href
        const active = typeof href === 'string' && isNavItemActive(href, pathname)
        return cloneElement(link, {
          className: cn(BASE, active ? ACTIVE : IDLE, link.props.className),
          ...(active ? { 'aria-current': 'page' } : {}),
          // Tapping a link inside the mobile drawer should dismiss it; on
          // desktop there is no drawer and this is null.
          onClick: closeDrawer ?? undefined,
        } as Partial<LinkLike['props']>)
      })}
    </nav>
  )
}
