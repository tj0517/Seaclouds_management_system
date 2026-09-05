// DCS 1a.13: route shell for apps/dcs, mirroring the pattern
// apps/timesheet/app/admin/AdminSidebar.tsx already established (sidebar +
// sign out + module switcher). Server component — no client state needed
// yet; nav is a single entry until later DCS phases add more routes.
import Link from 'next/link'
import ModuleSwitcher from './ModuleSwitcher'

type Props = {
  email: string
  fullName: string | null
  hasTesAccess: boolean
}

export default function DcsSidebar({ email, fullName, hasTesAccess }: Props) {
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col bg-white shadow-md">
      <div className="flex flex-col items-center gap-2 border-b p-6">
        <p className="text-lg font-bold">SCL DCS</p>
        <p className="text-center text-xs text-gray-500">{fullName ?? email}</p>
        <ModuleSwitcher hasTesAccess={hasTesAccess} />
      </div>

      <nav className="flex-1 space-y-2 p-4">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-4 py-3 text-gray-700 transition-colors hover:bg-blue-50"
        >
          Projects
        </Link>
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
