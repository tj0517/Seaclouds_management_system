// DCS 1a.13: route shell for every signed-in DCS page — sidebar + module
// switcher. /login and /mfa stay outside this group (no sidebar makes
// sense before a session, or mid-MFA-challenge). proxy.ts already redirects
// an unauthenticated request before it reaches here; the check below is
// defence in depth, matching apps/timesheet/app/admin/layout.tsx.
import { redirect } from 'next/navigation'
import { createClient } from '@scl/db/server'
import { fetchMyModules } from '@/lib/module-permissions'
import DcsSidebar from '@/components/DcsSidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const myModules = await fetchMyModules(supabase, user.id)

  return (
    <div className="flex min-h-screen bg-gray-100">
      <DcsSidebar
        email={user.email ?? ''}
        fullName={profile?.full_name ?? null}
        hasTesAccess={myModules.includes('tes')}
      />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
