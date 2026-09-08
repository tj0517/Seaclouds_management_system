// 1a.23: portal landing page. Was the TES home (timesheet grid) itself,
// now moved to /tes — see app/tes/page.tsx. Every existing link whose
// intent was "back to my timesheet" was repointed at /tes.
//
// TES tile is unconditional, same as ModuleSwitcher's own hardcoded current-
// module entry (app/components/ModuleSwitcher.tsx) — this app only ever
// serves TES, so it's never something module_permissions could usefully gate
// out from inside itself. DCS is the one real cross-module gate here,
// reusing the same read as the switcher — a missing or errored table fails
// closed for it (DCS tile hidden), same as the switcher.
//
// 1a.23 follow-up: a one-module account skips this page entirely and lands
// straight on that module — TES always counts (unconditional, per above),
// so the only way to have exactly one is hasDcs === false, and the only
// redirect target is ever /tes (there is no "dcs-only" case to redirect to
// DCS for: nothing in this app can produce a user who has dcs but not tes,
// and even if the admin screen ever allowed revoking tes while keeping dcs,
// TES's unconditional counting would still show both tiles rather than
// mis-redirect). No loop: /tes has exactly one redirect, to /login when
// unauthenticated — never back to /, so a redirect from here into /tes is
// terminal. On a DEGRADED read (table unreachable), never auto-redirect:
// collapsing to "one module" here would risk silently dropping the portal
// (and the DCS tile with it) for an admin who actually has two, which is
// wrong in a way a hidden tile elsewhere in this app isn't — DCS itself
// stays reachable regardless (its own proxy gate also fails open, see
// @scl/db/module-access), so showing the portal on a degraded read costs
// nothing and loses nothing.
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { getUserProfile, getMyModuleAccess } from '@/app/data/actions'
import AccountMenu from './components/AccountMenu'
import { PORTAL_NAME_PLACEHOLDER, MODULE_URLS } from '@/lib/portal-config'

export default async function PortalHome() {
  const result = await getUserProfile()
  if (!result || !result.user) redirect('/login')

  const { user } = result
  const { modules: myModules, degraded } = await getMyModuleAccess()
  const hasDcs = myModules.includes('dcs')

  if (!degraded && !hasDcs) {
    redirect('/tes')
  }

  const tiles = [
    {
      key: 'tes',
      label: 'TES',
      description: 'Timesheet — log hours, submit weeks, expenses.',
      href: '/tes',
    },
    hasDcs &&
      MODULE_URLS.dcs && {
        key: 'dcs',
        label: 'DCS',
        description: 'Document Control System.',
        href: MODULE_URLS.dcs,
      },
  ].filter((tile): tile is { key: string; label: string; description: string; href: string } => Boolean(tile))

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Sea Clouds" width={64} height={64} />
            <span
              className="text-sm font-medium text-gray-400 italic"
              title="Portal name placeholder — O-01 unresolved (docs/04-open-questions.md)"
            >
              {PORTAL_NAME_PLACEHOLDER}
            </span>
          </div>
          <AccountMenu email={user.email || ''} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Choose a module</h1>
        <p className="text-sm text-gray-500 mb-8">
          Modules you don&apos;t have access to are hidden or disabled.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiles.map((tile) => (
            <a
              key={tile.key}
              href={tile.href}
              className="block rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-blue-300 transition"
            >
              <h2 className="text-lg font-semibold text-gray-900">{tile.label}</h2>
              <p className="mt-1 text-sm text-gray-500">{tile.description}</p>
            </a>
          ))}

          {/* BMS: no app exists yet, always disabled — not gated by
              module_permissions like DCS above. */}
          <div
            className="block rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 cursor-not-allowed"
            title="BMS — not built yet"
          >
            <h2 className="text-lg font-semibold text-gray-300">BMS</h2>
            <p className="mt-1 text-sm text-gray-300">Not built yet.</p>
          </div>
        </div>
      </main>
    </div>
  )
}
