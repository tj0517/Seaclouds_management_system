// 1a.23: portal landing page. Was the TES home (timesheet grid) itself,
// now moved to /tes — see app/tes/page.tsx. Every existing link whose
// intent was "back to my timesheet" was repointed at /tes.
//
// TES tile is unconditional, same as ModuleSwitcher's own hardcoded current-
// module entry (app/components/ModuleSwitcher.tsx) — this app only ever
// serves TES, so it's never something module_permissions could usefully gate
// out from inside itself, and it sidesteps the degrade-loud table-missing
// case entirely: getMyModulePermissions() can't tell a genuinely empty grant
// set from a failed read (both return []), so making the current module
// depend on that read would risk hiding it on infra failure, exactly what
// item 4's "render only the current module" is guarding against. DCS is the
// one real cross-module gate here, reusing that same helper — a missing or
// errored table fails closed for it, same as the switcher.
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { getUserProfile, getMyModulePermissions } from '@/app/data/actions'
import AccountMenu from './components/AccountMenu'
import { PORTAL_NAME_PLACEHOLDER, MODULE_URLS } from '@/lib/portal-config'

export default async function PortalHome() {
  const result = await getUserProfile()
  if (!result || !result.user) redirect('/login')

  const { user } = result
  const myModules = await getMyModulePermissions()
  const hasDcs = myModules.includes('dcs')

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
