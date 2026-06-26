import { redirect } from 'next/navigation'
import { getUserProfile, getMyProjects, getWeeklyEntries, isWeekSubmitted, getMyAssignedSubProjects, getWeeklyContractCodes } from '@/app/data/actions'
import TimesheetGrid from './components/timesheetGrid'
import { startOfWeek, endOfWeek, format, addWeeks, subWeeks, parseISO, isValid } from 'date-fns'
import Link from 'next/link'
import { Shield, ChevronLeft, ChevronRight, Calendar, Receipt } from 'lucide-react'
import AccountMenu from './components/AccountMenu'
import ExportPdfButton from './components/ExportPdfButton'

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
  const projectIds = projects.map(p => p.id)
  const subProjects = await getMyAssignedSubProjects(projectIds)

  const entries = await getWeeklyEntries(
    user.id,
    format(weekStart, 'yyyy-MM-dd'),
    format(weekEnd, 'yyyy-MM-dd')
  )

  const submissionStatuses = await Promise.all(
    subProjects.map(async (sp) => {
      const status = await isWeekSubmitted(
        format(weekStart, 'yyyy-MM-dd'),
        sp.id
      )
      return { [sp.id]: status }
    })
  )
  const initialSubmissionStatus: Record<string, { status: string; rejectReason: string | null } | null> = Object.assign({}, ...submissionStatuses)

  const contractCodes = await getWeeklyContractCodes(user.id, format(weekStart, 'yyyy-MM-dd'))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* NAGŁÓWEK */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          {/* Top row: title + nav links + account */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold text-gray-900 shrink-0">Timesheet</h1>

            <nav className="flex items-center gap-1 sm:gap-2">
              <Link href="/expenses" className="text-sm font-medium text-gray-600 hover:text-gray-800 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-gray-100 transition">
                <Receipt size={16} /> <span className="hidden sm:inline">Expenses</span>
              </Link>
              {isAdmin && (
                <Link href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-blue-50 transition">
                  <Shield size={16} /> <span className="hidden sm:inline">Admin</span>
                </Link>
              )}
              <AccountMenu email={user.email || ''} />
            </nav>
          </div>

          {/* Bottom row: week navigation + export */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <Link
                href={`/?date=${prevWeekDate}`}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition text-gray-600"
                title="Previous week"
              >
                <ChevronLeft size={18} />
              </Link>

              <div className="flex items-center gap-1.5 px-3 font-medium text-gray-700 text-sm min-w-[130px] justify-center">
                <Calendar size={14} className="text-gray-400" />
                <span>{format(weekStart, 'dd.MM')} - {format(weekEnd, 'dd.MM')}</span>
              </div>

              <Link
                href={`/?date=${nextWeekDate}`}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition text-gray-600"
                title="Next week"
              >
                <ChevronRight size={18} />
              </Link>
            </div>

            <ExportPdfButton />
          </div>
        </div>
      </header>

      {/* TREŚĆ */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <TimesheetGrid
          key={weekStart.toString()}
          projects={projects}
          subProjects={subProjects}
          existingEntries={entries || []}
          weekStart={weekStart}
          initialSubmissionStatus={initialSubmissionStatus}
          initialContractCodes={contractCodes}
        />
      </main>
    </div>
  )
}
