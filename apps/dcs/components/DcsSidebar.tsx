// DCS 1a.13: route shell for apps/dcs, mirroring the pattern
// apps/timesheet/app/admin/AdminSidebar.tsx already established (sidebar +
// sign out + module switcher). Server component — no client state needed
// here, and deliberately still none after 1a.24.
//
// DCS 1a.21a: the admin screens stop being direct-URL-only (deferred-tasks
// (bb), partially closed — a users list still does not exist, so there is
// nothing to link for /admin/users). Visibility mirrors the page guards the
// same task added to /admin/dictionaries and /admin/clients — admin, or the
// DC of any project (isAdminOrAnyDc) — decided once in
// app/(app)/layout.tsx and passed in here. This is discovery only: the
// guards on those pages, and RLS underneath them, are what actually decide
// access. 1a.24 restyled this file and changed nothing about that.
//
// DCS 1a.24: closes both remaining halves of deferred-tasks (x) — lucide
// icons on every entry (one pass, so no second style is introduced) and the
// mobile drawer, which lives in components/AppShell.tsx and reuses this exact
// component rather than a phone-shaped copy of it.
//
// The three <Link> elements are built HERE, in this component's own returned
// tree, and handed to SidebarNav as children for the active-item styling.
// That is load-bearing: app/(app)/nav.test.ts calls this function directly
// and asserts the next/link hrefs it returns. Moving the links into a client
// component would hide them from that test and force this file to become a
// client component to read the pathname.
import Link from 'next/link'
import { FolderKanban, BookMarked, Building2, LogOut } from 'lucide-react'
import ModuleSwitcher from './ModuleSwitcher'
import NavLinkStatus from './NavLinkStatus'
import SidebarNav from './SidebarNav'

type Props = {
  email: string
  fullName: string | null
  hasTesAccess: boolean
  canSeeAdminLinks: boolean
}

const ICON = 'h-4 w-4 shrink-0'

/** Initials for the avatar block; falls back to the email's first letter. */
function initials(fullName: string | null, email: string): string {
  const source = fullName?.trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts.length > 1 ? (parts[1][0] ?? '') : '').toUpperCase()
}

export default function DcsSidebar({ email, fullName, hasTesAccess, canSeeAdminLinks }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b px-4 py-4">
        <div className="flex items-center gap-2">
          {/* Not a <Link>: nav.test.ts asserts the sidebar offers exactly the
              three nav hrefs, and a logo linking home would be a fourth. The
              "Projects" entry below is the way home. */}
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground"
          >
            SC
          </span>
          <span className="text-sm font-semibold tracking-tight">SCL DCS</span>
        </div>
        {hasTesAccess && <ModuleSwitcher hasTesAccess={hasTesAccess} />}
      </div>

      <SidebarNav>
        <Link href="/">
          <FolderKanban className={ICON} />
          Projects
          <NavLinkStatus />
        </Link>
        {canSeeAdminLinks ? (
          <Link href="/admin/dictionaries">
            <BookMarked className={ICON} />
            Dictionaries
            <NavLinkStatus />
          </Link>
        ) : null}
        {canSeeAdminLinks ? (
          <Link href="/admin/clients">
            <Building2 className={ICON} />
            Clients
            <NavLinkStatus />
          </Link>
        ) : null}
      </SidebarNav>

      <div className="mt-auto border-t px-3 py-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
          >
            {initials(fullName, email)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{fullName ?? email}</span>
            {fullName ? <span className="block truncate text-xs text-muted-foreground">{email}</span> : null}
          </span>
        </div>
        <form action="/auth/signout" method="post">
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
            <LogOut className={ICON} />
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
