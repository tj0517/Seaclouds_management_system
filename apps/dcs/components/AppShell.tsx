'use client'

// DCS 1a.24: the signed-in route shell — a fixed sidebar from 768px up, the
// same sidebar in a drawer below it (deferred-tasks (x), the mobile-drawer
// half). The sidebar itself is still rendered on the server and handed in as
// a prop, so app/(app)/layout.tsx keeps doing the Supabase reads and this
// file never learns anything about who the user is.
//
// <main> deliberately does NOT carry overflow-auto any more. It used to, and
// that is why the old layout reported "no horizontal page scroll" at 375px
// while silently clipping up to 698px of a table off-screen. Wide content now
// scrolls inside its own container (see ScrollableTable); the page never does.
//
// CHILDREN ARE POSITIONAL: the first child is the sidebar, the rest is the
// page. That is not a style preference — app/(app)/nav.test.ts finds
// DcsSidebar by walking props.children from the layout's returned tree, and
// it never looks at other props, so a `sidebar={<DcsSidebar/>}` prop would
// make the sidebar invisible to a test this task must not edit. Same reason
// SidebarNav takes its links as children.
import { Children, createContext, useContext, useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

const CloseDrawerContext = createContext<(() => void) | null>(null)

/** Lets a nav item dismiss the drawer it was tapped in. Null on desktop. */
export function useCloseDrawer() {
  return useContext(CloseDrawerContext)
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [sidebar, ...page] = Children.toArray(children)

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r bg-card md:flex md:flex-col">{sidebar}</aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">DCS navigation</SheetTitle>
          <CloseDrawerContext.Provider value={() => setOpen(false)}>{sidebar}</CloseDrawerContext.Provider>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-card px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold tracking-tight">SCL DCS</span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{page}</main>
      </div>
    </div>
  )
}
