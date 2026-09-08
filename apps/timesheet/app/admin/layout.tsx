// app/admin/layout.tsx
import { getUserProfile, getMyModuleAccess } from '@/app/data/actions'
import { isAdminOrPM } from '@/app/data/actions/auth-helpers'
import { redirect } from 'next/navigation'
import AdminSidebar from './AdminSidebar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await getUserProfile()

  if (!result || !result.user) {
    redirect('/login')
  }

  const { profile } = result

  if (!profile || !profile.role || !isAdminOrPM(profile.role)) {
    redirect('/')
  }

  // Switcher renders only for a 2+ module account; on a degraded read, fail
  // open rather than guess "one module" (see getMyModuleAccess()).
  const { modules: myModules, degraded } = await getMyModuleAccess()
  const hasDcsAccess = degraded || myModules.includes('dcs')

  return (
    <div className="flex h-screen bg-gray-100">
      <AdminSidebar email={result.user.email} role={profile.role} hasDcsAccess={hasDcsAccess} />

      {/* GŁÓWNA TREŚĆ */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}