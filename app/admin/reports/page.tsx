import { getGroupedReportData, getReportFilterOptions } from '@/app/data/actions/timesheet'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, eachWeekOfInterval, addDays, parseISO, startOfWeek, min, max } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Filter, FileText, Calendar, CheckCircle2, Clock, Users, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import WeeklyReportSlider, { type WeekData } from './WeeklyReportSlider'

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

  const [rows, filterOptions] = await Promise.all([
    getGroupedReportData(dateFrom, dateTo, {
      userName: filterUser || undefined,
      subProjectCode: filterCode || undefined,
      projectName: filterProject || undefined,
    }),
    getReportFilterOptions(dateFrom, dateTo),
  ])

  // Generate weeks in the range, each with its days clamped to the from/to range
  const rangeStart = parseISO(dateFrom)
  const rangeEnd = parseISO(dateTo)

  const weekStartDates = eachWeekOfInterval(
    { start: rangeStart, end: rangeEnd },
    { weekStartsOn: 1 }
  )

  const weeks = weekStartDates.map(ws => {
    const weekEnd = addDays(ws, 6)
    const clampedStart = max([ws, rangeStart])
    const clampedEnd = min([weekEnd, rangeEnd])
    const days = eachDayOfInterval({ start: clampedStart, end: clampedEnd }).map(d => format(d, 'yyyy-MM-dd'))
    return {
      weekStart: format(ws, 'yyyy-MM-dd'),
      weekEndLabel: format(min([weekEnd, rangeEnd]), 'dd.MM'),
      weekStartLabel: format(max([ws, rangeStart]), 'dd.MM'),
      days,
    }
  })

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

  // Build serializable WeekData[] for the client slider
  const weekData: WeekData[] = weeks
    .map(week => {
      const days = week.days.map(d => {
        const date = parseISO(d)
        return {
          key: d,
          dayName: format(date, 'EEE', { locale: enUS }),
          dateLabel: format(date, 'dd.MM'),
          isWeekend: date.getDay() === 0 || date.getDay() === 6,
        }
      })

      const projects = Object.entries(byProject)
        .map(([projectName, projectData]) => {
          const projectWeekRows = rows.filter(r => r.projectName === projectName)

          const subProjects = Object.entries(projectData.subProjects)
            .map(([spCode, spData]) => {
              const usersWithHours = spData.users
                .filter(u => week.days.some(d => (u.dailyBreakdown[d] ?? 0) > 0))
                .map(u => ({
                  userName: u.userName,
                  isSubmitted: u.isSubmitted,
                  dailyHours: Object.fromEntries(week.days.map(d => [d, u.dailyBreakdown[d] ?? 0])),
                  weekTotal: week.days.reduce((s, d) => s + (u.dailyBreakdown[d] ?? 0), 0),
                }))
              return { code: spCode, description: spData.description, users: usersWithHours }
            })
            .filter(sp => sp.users.length > 0)

          const dailyTotals = Object.fromEntries(
            week.days.map(d => [d, projectWeekRows.reduce((s, r) => s + (r.dailyBreakdown[d] ?? 0), 0)])
          )
          const weekTotal = Object.values(dailyTotals).reduce((a, b) => a + b, 0)

          return { name: projectName, code: projectData.code, subProjects, weekTotal, dailyTotals }
        })
        .filter(p => p.weekTotal > 0)

      const weekTotal = projects.reduce((s, p) => s + p.weekTotal, 0)

      return {
        weekStart: week.weekStart,
        weekStartLabel: week.weekStartLabel,
        weekEndLabel: week.weekEndLabel,
        days,
        projects,
        weekTotal,
      }
    })
    .filter(w => w.weekTotal > 0)

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-8 w-8 text-primary" /> Reports
          </h2>
          <p className="text-muted-foreground mt-1">Work hours breakdown by project, code, and employee.</p>
        </div>
      </div>

      {/* FILTER BAR */}
      <Card>
        <CardContent className="pt-4">
          <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">From</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="date" name="from" defaultValue={dateFrom} className="pl-9" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">To</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="date" name="to" defaultValue={dateTo} className="pl-9" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Project</label>
              <select
                name="project"
                defaultValue={filterProject}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All projects</option>
                {filterOptions.projectNames.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Code</label>
              <select
                name="code"
                defaultValue={filterCode}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All codes</option>
                {filterOptions.subProjectCodes.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Employee</label>
              <select
                name="user"
                defaultValue={filterUser}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All employees</option>
                {filterOptions.users.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                <Filter className="mr-2 h-4 w-4" /> Filter
              </Button>
              {activeFilters > 0 && (
                <Link
                  href={`/admin/reports?from=${dateFrom}&to=${dateTo}`}
                  className="flex items-center gap-1 px-3 py-2 rounded-md border border-input text-sm text-muted-foreground hover:bg-accent"
                  title="Clear filters"
                >
                  <X className="h-4 w-4" />
                </Link>
              )}
            </div>
          </form>

          {activeFilters > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground self-center">Active filters:</span>
              {filterProject && (
                <Badge variant="secondary" className="gap-1">
                  Project: {filterProject}
                </Badge>
              )}
              {filterCode && (
                <Badge variant="secondary" className="gap-1">
                  Code: {filterCode}
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
          { label: 'Total Hours', value: `${totalHours}h`, icon: Clock },
          { label: 'Employees', value: uniqueUsers, icon: Users },
          { label: 'Projects', value: uniqueProjects, icon: FileText },
          { label: 'Submitted Rows', value: totalSubmitted, icon: CheckCircle2 },
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

      {/* WEEKLY TABLES */}
      <WeeklyReportSlider weeks={weekData} />
    </div>
  )
}
