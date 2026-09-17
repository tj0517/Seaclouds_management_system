// DCS 1a.13: route shell for every signed-in DCS page — sidebar + module
// switcher. /login and /mfa stay outside this group (no sidebar makes
// sense before a session, or mid-MFA-challenge). proxy.ts already redirects
// an unauthenticated request before it reaches here; the check below is
// defence in depth, matching apps/timesheet/app/admin/layout.tsx.
import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import { canOpenAdminScreens } from '@/lib/auth-helpers'
import { fetchMyModuleAccess } from '@/lib/module-permissions'
import AppShell from '@/components/AppShell'
import DcsSidebar from '@/components/DcsSidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle()
  // Switcher renders only for a 2+ module account; on a degraded read, fail
  // open rather than guess "one module" (see fetchMyModuleAccess()) — the
  // trap being that failing closed here would strand a two-module user
  // inside DCS with no way back to TES.
  const { modules: myModules, degraded } = await fetchMyModuleAccess(supabase, user.id)
  const hasTesAccess = degraded || myModules.includes('tes')

  // DCS 1a.21a: which nav links the sidebar offers — the same decision the
  // two guarded pages make for themselves, so a visible link never leads to
  // a redirect and a hidden one never hides a reachable page. Cosmetic on
  // its own: canOpenAdminScreens() is called again inside each page.
  const canSeeAdminLinks = await canOpenAdminScreens(supabase, user.id, profile?.role === 'admin')

  // DCS 1a.24: the chrome moved into AppShell (drawer below 768px, fixed
  // sidebar above it). The sidebar is still rendered here, on the server,
  // and passed down as an element — AppShell is a client component and must
  // not do any of the reads above.
  return (
    <AppShell>
      <DcsSidebar
        email={user.email ?? ''}
        fullName={profile?.full_name ?? null}
        hasTesAccess={hasTesAccess}
        canSeeAdminLinks={canSeeAdminLinks}
      />
      {children}
    </AppShell>
  )
}
