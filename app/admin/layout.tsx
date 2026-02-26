// app/admin/layout.tsx
import { getUserProfile } from '@/app/data/actions'
import { redirect } from 'next/navigation'
import AdminSidebar from './AdminSidebar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {


  // 1. Sprawdź sesję i profil
  const result = await getUserProfile()

  if (!result || !result.user) {
    redirect('/login')
  }

  const { profile } = result

  // Logika przekierowania
  if (profile?.role !== 'admin') {
    redirect('/')
  }




  return (
    <div className="flex h-screen bg-gray-100">
      <AdminSidebar email={result.user.email} />

      {/* GŁÓWNA TREŚĆ */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}