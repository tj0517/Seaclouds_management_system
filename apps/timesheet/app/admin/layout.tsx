// app/admin/layout.tsx
import { getUserProfile, getMyModulePermissions } from '@/app/data/actions'
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

  const myModules = await getMyModulePermissions()

  return (
    <div className="flex h-screen bg-gray-100">
      <AdminSidebar email={result.user.email} role={profile.role} hasDcsAccess={myModules.includes('dcs')} />

      {/* GŁÓWNA TREŚĆ */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}