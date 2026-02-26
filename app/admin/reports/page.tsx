import { getGroupedReportData, getReportFilterOptions } from '@/app/data/actions/timesheet'
import { format, startOfMonth, endOfMonth, eachWeekOfInterval, parseISO } from 'date-fns'
import { pl } from 'date-fns/locale'
import { Filter, FileText, Calendar, CheckCircle2, Clock, Users, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

type Props = {
  searchParams: Promise<{ from?: string; to?: string; user?: string; code?: string; project?: string }>
}

export default async function ReportsPage(props: Props) {
  const searchParams = await props.searchParams

  const today = new Date()
  const defaultFrom = format(startOfMonth(today), 'yyyy-MM-dd')
  const defaultTo = format(endOfMonth(today), 'yyyy-MM-dd')

  const dateFrom = searchParams.from || defaultFrom
  const dateTo = searchParams.to || defaultTo
  const filterUser = searchParams.user || ''
  const filterCode = searchParams.code || ''
  const filterProject = searchParams.project || ''

  // Fetch filter options (unfiltered — always show all available for the date range)
  const [rows, filterOptions] = await Promise.all([
    getGroupedReportData(dateFrom, dateTo, {
      userName: filterUser || undefined,
      subProjectCode: filterCode || undefined,
      projectName: filterProject || undefined,
    }),
    getReportFilterOptions(dateFrom, dateTo),
  ])

  // Collect all weeks in the range for column headers
  const allWeeks: string[] = eachWeekOfInterval(
    { start: parseISO(dateFrom), end: parseISO(dateTo) },
    { weekStartsOn: 1 }
  ).map(d => format(d, 'yyyy-MM-dd'))

  // Summary stats
  const totalHours = rows.reduce((s, r) => s + r.totalHours, 0)
  const uniqueUsers = new Set(rows.map(r => r.userName)).size
  const uniqueProjects = new Set(rows.map(r => r.projectName)).size
  const totalSubmitted = rows.filter(r => r.isSubmitted).length

  // Active filter count (excluding dates)
  const activeFilters = [filterUser, filterCode, filterProject].filter(Boolean).length

  // Group rows by project
  const byProject = rows.reduce((acc, row) => {
    if (!acc[row.projectName]) acc[row.projectName] = { code: row.projectCode, subProjects: {} }
    if (!acc[row.projectName].subProjects[row.subProjectCode]) {
      acc[row.projectName].subProjects[row.subProjectCode] = { description: row.subProjectDescription, users: [] }
    }
    acc[row.projectName].subProjects[row.subProjectCode].users.push(row)
    return acc
  }, {} as Record<string, { code: string | null; subProjects: Record<string, { description: string | null; users: typeof rows }> }>)

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-8 w-8 text-primary" /> Raporty
          </h2>
          <p className="text-muted-foreground mt-1">Zestawienie godzin pracy według projektu, kodu i pracownika.</p>
        </div>
      </div>

      {/* FILTER BAR */}
      <Card>
        <CardContent className="pt-4">
          <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
            {/* Date range */}
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Data od</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="date" name="from" defaultValue={dateFrom} className="pl-9" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Data do</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="date" name="to" defaultValue={dateTo} className="pl-9" />
              </div>
            </div>

            {/* Project filter */}
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Projekt</label>
              <select
                name="project"
                defaultValue={filterProject}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Wszystkie projekty</option>
                {filterOptions.projectNames.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Sub-project code filter */}
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Kod</label>
              <select
                name="code"
                defaultValue={filterCode}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Wszystkie kody</option>
                {filterOptions.subProjectCodes.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* User filter */}
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Pracownik</label>
              <select
                name="user"
                defaultValue={filterUser}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Wszyscy pracownicy</option>
                {filterOptions.users.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                <Filter className="mr-2 h-4 w-4" /> Filtruj
              </Button>
              {activeFilters > 0 && (
                <Link
                  href={`/admin/reports?from=${dateFrom}&to=${dateTo}`}
                  className="flex items-center gap-1 px-3 py-2 rounded-md border border-input text-sm text-muted-foreground hover:bg-accent"
                  title="Wyczyść filtry"
                >
                  <X className="h-4 w-4" />
                </Link>
              )}
            </div>
          </form>

          {/* Active filter badges */}
          {activeFilters > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground self-center">Aktywne filtry:</span>
              {filterProject && (
                <Badge variant="secondary" className="gap-1">
                  Projekt: {filterProject}
                </Badge>
              )}
              {filterCode && (
                <Badge variant="secondary" className="gap-1">
                  Kod: {filterCode}
                </Badge>
              )}
              {filterUser && (
                <Badge variant="secondary" className="gap-1">
                  <Users className="h-3 w-3" /> {filterUser}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Suma godzin', value: `${totalHours}h`, icon: Clock },
          { label: 'Pracownicy', value: uniqueUsers, icon: Users },
          { label: 'Projekty', value: uniqueProjects, icon: FileText },
          { label: 'Zatwierdzone wiersze', value: totalSubmitted, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* MAIN TABLE — grouped by project > sub-project > user */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Brak wpisów dla wybranych filtrów.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(byProject).map(([projectName, projectData]) => (
            <Card key={projectName}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg">{projectName}</CardTitle>
                  {projectData.code && (
                    <Badge variant="outline" className="font-mono text-xs">{projectData.code}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Kod</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Opis</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">Pracownik</th>
                        {allWeeks.map(w => (
                          <th key={w} className="text-center px-2 py-2 font-medium text-gray-600 whitespace-nowrap">
                            <div className="text-xs text-gray-400">tyg.</div>
                            <div>{format(parseISO(w), 'dd.MM', { locale: pl })}</div>
                          </th>
                        ))}
                        <th className="text-center px-3 py-2 font-bold text-gray-800 bg-gray-100 w-16">Σ</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {Object.entries(projectData.subProjects).map(([spCode, spData]) =>
                        spData.users.map((userRow, idx) => (
                          <tr key={`${spCode}-${userRow.userName}`} className="hover:bg-gray-50">
                            {idx === 0 && (
                              <td className="px-3 py-2 font-mono text-xs text-blue-700 font-semibold align-top" rowSpan={spData.users.length}>
                                {spCode}
                              </td>
                            )}
                            {idx === 0 && (
                              <td className="px-3 py-2 text-xs text-gray-500 align-top" rowSpan={spData.users.length}>
                                {spData.description || '—'}
                              </td>
                            )}
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {userRow.userName.charAt(0)}
                                </div>
                                {userRow.userName}
                              </div>
                            </td>
                            {allWeeks.map(w => (
                              <td key={w} className="px-2 py-2 text-center">
                                {userRow.weekBreakdown[w]
                                  ? <span className="font-medium text-gray-800">{userRow.weekBreakdown[w]}h</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center font-bold text-blue-600 bg-gray-50">{userRow.totalHours}h</td>
                            <td className="px-3 py-2 text-center">
                              {userRow.isSubmitted ? (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Zatwierdzony
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-300">Oczekuje</Badge>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                      {/* Project subtotal */}
                      <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                        <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-500 uppercase tracking-wide">Suma projektu</td>
                        {allWeeks.map(w => {
                          const t = rows.filter(r => r.projectName === projectName).reduce((s, r) => s + (r.weekBreakdown[w] ?? 0), 0)
                          return (
                            <td key={w} className="px-2 py-2 text-center text-sm">
                              {t > 0 ? <span className="font-bold">{t}h</span> : <span className="text-gray-300">—</span>}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-center text-blue-700 bg-blue-50">
                          {rows.filter(r => r.projectName === projectName).reduce((s, r) => s + r.totalHours, 0)}h
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}