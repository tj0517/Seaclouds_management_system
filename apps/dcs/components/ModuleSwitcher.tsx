// DCS 1a.13: navigation between the portal's separate Next.js deployments
// (DCS here, TES at MODULE_URLS.tes) — plain absolute links, not
// client-side routing. Crossing modules may require signing in again until
// 1a.23 (shared sign-on) lands; that gap is intentional, see the PR
// description. No client interactivity here, so this stays a server
// component like the rest of this app's pages.
import { MODULE_URLS, PORTAL_NAME_PLACEHOLDER } from '@/lib/portal-config'

type Props = {
  hasTesAccess: boolean
}

const entryClass = 'rounded px-2 py-1 text-xs font-medium transition'

export default function ModuleSwitcher({ hasTesAccess }: Props) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 bg-gray-50 py-1 pl-2 pr-1"
      aria-label={`${PORTAL_NAME_PLACEHOLDER} module switcher`}
    >
      <span
        className="text-[11px] italic text-gray-400"
        title="Portal name placeholder — O-01 unresolved (docs/04-open-questions.md)"
      >
        {PORTAL_NAME_PLACEHOLDER}
      </span>
      <span className="h-3 w-px bg-gray-300" aria-hidden="true" />
      {hasTesAccess && MODULE_URLS.tes && (
        <a href={MODULE_URLS.tes} className={`${entryClass} text-gray-500 hover:bg-white hover:text-gray-900`}>
          TES
        </a>
      )}
      <span className={`${entryClass} bg-white text-gray-900 shadow-sm`}>DCS</span>
      {/* BMS: no app exists yet, so this is always a disabled placeholder —
          not gated by module_permissions like TES/DCS above. */}
      <span className={`${entryClass} cursor-not-allowed text-gray-300`} title="BMS — not built yet">
        BMS
      </span>
    </div>
  )
}
