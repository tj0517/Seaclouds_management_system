// DCS 1a.13: route shell for apps/dcs, mirroring the pattern
// apps/timesheet/app/admin/AdminSidebar.tsx already established (sidebar +
// sign out + module switcher). Server component — no client state needed
// yet.
//
// DCS 1a.21a: the admin screens stop being direct-URL-only (deferred-tasks
// (bb), partially closed — a users list still does not exist, so there is
// nothing to link for /admin/users). Visibility mirrors the page guards the
// same task added to /admin/dictionaries and /admin/clients — admin, or the
// DC of any project (isAdminOrAnyDc) — decided once in
// app/(app)/layout.tsx and passed in here. This is discovery only: the
// guards on those pages, and RLS underneath them, are what actually decide
// access.
//
// Still no icon library and no mobile drawer (deferred-tasks (x)) — both are
// out of this task's scope, so the new entries match the existing plain-text
// "Projects" link rather than introducing a second style.
import Link from 'next/link'
import ModuleSwitcher from './ModuleSwitcher'

type Props = {
  email: string
  fullName: string | null
  hasTesAccess: boolean
  canSeeAdminLinks: boolean
}

const NAV_LINK_CLASS =
  'flex items-center gap-3 rounded-lg px-4 py-3 text-gray-700 transition-colors hover:bg-blue-50'

export default function DcsSidebar({ email, fullName, hasTesAccess, canSeeAdminLinks }: Props) {
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col bg-white shadow-md">
      <div className="flex flex-col items-center gap-2 border-b p-6">
        <p className="text-lg font-bold">SCL DCS</p>
        <p className="text-center text-xs text-gray-500">{fullName ?? email}</p>
        {hasTesAccess && <ModuleSwitcher hasTesAccess={hasTesAccess} />}
      </div>

      <nav className="flex-1 space-y-2 p-4">
        <Link href="/" className={NAV_LINK_CLASS}>
          Projects
        </Link>
        {canSeeAdminLinks && (
          <>
            <Link href="/admin/dictionaries" className={NAV_LINK_CLASS}>
              Dictionaries
            </Link>
            <Link href="/admin/clients" className={NAV_LINK_CLASS}>
              Clients
            </Link>
          </>
        )}
      </nav>

      <div className="border-t p-4">
        <form action="/auth/signout" method="post">
          <button className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-red-600 hover:bg-red-50">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
