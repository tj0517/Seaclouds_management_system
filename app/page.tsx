import { redirect } from 'next/navigation'
import { getUserProfile, getMyProjects, getWeeklyEntries } from '@/app/data/actions'
import TimesheetGrid from './components/timesheetGrid'
import { startOfWeek, endOfWeek, format, addWeeks, subWeeks, parseISO, isValid } from 'date-fns'
import Link from 'next/link'
import { LogOut, Shield, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

// Definiujemy typ propsów z searchParams (w Next.js 15+ to Promise)
type Props = {
  searchParams: Promise<{ date?: string }>
}

export default async function Home(props: Props) {
  const searchParams = await props.searchParams
  // 1. Sprawdź sesję
  const result = await getUserProfile()
  if (!result || !result.user) redirect('/login')

  const { user, profile } = result

  const isAdmin = profile?.role === 'admin'

  // 3. LOGIKA DATY (SERCE NAWIGACJI)
  // Jeśli w URL jest data (?date=...), użyj jej. Jeśli nie, użyj dzisiaj.
  let referenceDate = new Date()
  if (searchParams.date) {
    const parsed = parseISO(searchParams.date)
    if (isValid(parsed)) {
      referenceDate = parsed
    }
  }

  // Wyliczamy zakres tygodnia dla wybranej daty
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 })

  // Wyliczamy daty dla przycisków nawigacji
  const prevWeekDate = format(subWeeks(referenceDate, 1), 'yyyy-MM-dd')
  const nextWeekDate = format(addWeeks(referenceDate, 1), 'yyyy-MM-dd')

  // 4. Pobierz dane dla TEGO KONKRETNEGO tygodnia
  const projects = await getMyProjects()
  const entries = await getWeeklyEntries(
    user.id,
    format(weekStart, 'yyyy-MM-dd'),
    format(weekEnd, 'yyyy-MM-dd')
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* NAGŁÓWEK */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">

          {/* LEWA STRONA: Tytuł i Nawigacja */}
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-gray-900 hidden sm:block">Mój Grafik</h1>

            {/* Kontrolery nawigacji */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <Link
                href={`/?date=${prevWeekDate}`}
                className="p-2 hover:bg-white hover:shadow-sm rounded-md transition text-gray-600"
                title="Poprzedni tydzień"
              >
                <ChevronLeft size={20} />
              </Link>

              <div className="flex items-center gap-2 px-4 font-medium text-gray-700 min-w-[140px] justify-center">
                <Calendar size={16} className="text-gray-400" />
                <span>{format(weekStart, 'dd.MM')} - {format(weekEnd, 'dd.MM')}</span>
              </div>

              <Link
                href={`/?date=${nextWeekDate}`}
                className="p-2 hover:bg-white hover:shadow-sm rounded-md transition text-gray-600"
                title="Następny tydzień"
              >
                <ChevronRight size={20} />
              </Link>
            </div>
          </div>

          {/* PRAWA STRONA: Akcje użytkownika */}
          <div className="flex items-center gap-4">
            {isAdmin && (
              <Link href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-3 py-2 rounded-lg">
                <Shield size={16} /> <span className="hidden sm:inline">Panel Admina</span>
              </Link>
            )}

            <form action="/auth/signout" method="post">
              <button className="text-sm text-gray-600 hover:text-red-600 flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-red-50 transition">
                <LogOut size={16} /> <span className="hidden sm:inline">Wyloguj</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* TREŚĆ */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <TimesheetGrid
          // Kluczowe: dodajemy key={weekStart}, żeby wymusić odświeżenie komponentu przy zmianie tygodnia
          key={weekStart.toString()}
          projects={projects}
          existingEntries={entries || []}
          weekStart={weekStart}
        />
      </main>
    </div>
  )
}