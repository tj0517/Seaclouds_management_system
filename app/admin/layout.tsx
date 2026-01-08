// app/admin/layout.tsx
import { getUserProfile } from '@/app/data/actions'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, FolderKanban, Users, LogOut, FileText, Clock, ChartAreaIcon } from 'lucide-react'

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
      {/* SIDEBAR */}
      <aside className="w-64 bg-white shadow-md flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-blue-600">Admin Panel</h1>
          <p className="text-xs text-gray-500 mt-1">{result.user.email}</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <Link href="/admin" className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors">
            <LayoutDashboard size={20} />
            Dashboard
          </Link>
          <Link href="/admin/stats" className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors">
            <ChartAreaIcon size={20} />
            Statystyki
          </Link>
          <Link href="/admin/projects" className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors">
            <FolderKanban size={20} />
            Projekty
          </Link>
          <Link href="/admin/users" className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors">
            <Users size={20} />
            Pracownicy
          </Link>
          <Link href="/admin/reports" className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors">
            <FileText size={20} />
            Raporty
          </Link>
          <Link href="/" className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors">
            <Clock size={20} />
            Raportuj godziny
          </Link>

        </nav>

        <div className="p-4 border-t">
          <form action="/auth/signout" method="post">
            {/* Tutaj przydałby się przycisk wylogowania, na razie atrapa */}
            <button className="flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 w-full rounded-lg">
              <LogOut size={20} />
              Wyloguj
            </button>
          </form>
        </div>
      </aside>

      {/* GŁÓWNA TREŚĆ */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}