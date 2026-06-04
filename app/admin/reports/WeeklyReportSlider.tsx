'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, CheckCircle2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminWithdrawSubmission } from '@/app/data/actions/timesheet'
import { toast } from 'sonner'

export type UserRow = {
  userId: string
  userName: string
  subProjectId: string
  isSubmitted: boolean
  trackingType?: 'hours' | 'days'
  dailyHours: Record<string, number>
  weekTotal: number
}

export type SubProjectData = {
  code: string
  subProjectId: string
  description: string | null
  trackingType?: 'hours' | 'days'
  users: UserRow[]
}

export type ProjectData = {
  name: string
  code: string | null
  subProjects: SubProjectData[]
  weekTotal: number
  dailyTotals: Record<string, number>
}

export type WeekData = {
  weekStart: string
  weekStartLabel: string
  weekEndLabel: string
  days: { key: string; dayName: string; dateLabel: string; isWeekend: boolean }[]
  projects: ProjectData[]
  weekTotal: number
}

type ViewMode = 'day' | 'week'

// Aggregated data for the week summary view
type AggregatedUser = {
  userName: string
  weeklyHours: Record<string, number> // weekStart -> hours
  total: number
  isSubmitted: boolean
}

type AggregatedSubProject = {
  code: string
  description: string | null
  trackingType?: 'hours' | 'days'
  users: AggregatedUser[]
}

type AggregatedProject = {
  name: string
  code: string | null
  subProjects: AggregatedSubProject[]
  weeklyTotals: Record<string, number> // weekStart -> hours
  total: number
}

function buildAggregatedProjects(weeks: WeekData[]): AggregatedProject[] {
  const projectMap = new Map<string, {
    code: string | null
    subProjectMap: Map<string, {
      description: string | null
      trackingType?: 'hours' | 'days'
      userMap: Map<string, { weeklyHours: Record<string, number>; total: number; isSubmitted: boolean }>
    }>
    weeklyTotals: Record<string, number>
    total: number
  }>()

  for (const week of weeks) {
    for (const project of week.projects) {
      let pEntry = projectMap.get(project.name)
      if (!pEntry) {
        pEntry = { code: project.code, subProjectMap: new Map(), weeklyTotals: {}, total: 0 }
        projectMap.set(project.name, pEntry)
      }
      pEntry.weeklyTotals[week.weekStart] = (pEntry.weeklyTotals[week.weekStart] ?? 0) + project.weekTotal
      pEntry.total += project.weekTotal

      for (const sp of project.subProjects) {
        let spEntry = pEntry.subProjectMap.get(sp.code)
        if (!spEntry) {
          spEntry = { description: sp.description, trackingType: sp.trackingType, userMap: new Map() }
          pEntry.subProjectMap.set(sp.code, spEntry)
        }

        for (const user of sp.users) {
          let uEntry = spEntry.userMap.get(user.userName)
          if (!uEntry) {
            uEntry = { weeklyHours: {}, total: 0, isSubmitted: true }
            spEntry.userMap.set(user.userName, uEntry)
          }
          uEntry.weeklyHours[week.weekStart] = (uEntry.weeklyHours[week.weekStart] ?? 0) + user.weekTotal
          uEntry.total += user.weekTotal
          if (!user.isSubmitted) uEntry.isSubmitted = false
        }
      }
    }
  }

  return Array.from(projectMap.entries()).map(([name, p]) => ({
    name,
    code: p.code,
    total: p.total,
    weeklyTotals: p.weeklyTotals,
    subProjects: Array.from(p.subProjectMap.entries()).map(([code, sp]) => ({
      code,
      description: sp.description,
      trackingType: sp.trackingType,
      users: Array.from(sp.userMap.entries()).map(([userName, u]) => ({
        userName,
        weeklyHours: u.weeklyHours,
        total: u.total,
        isSubmitted: u.isSubmitted,
      })),
    })),
  }))
}

function StatusCell({ userRow, weekStart }: { userRow: UserRow; weekStart: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [withdrawn, setWithdrawn] = useState(false)

  if (!userRow.isSubmitted || withdrawn) {
    return <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
  }

  const handleWithdraw = async () => {
    setLoading(true)
    const result = await adminWithdrawSubmission(userRow.userId, weekStart, userRow.subProjectId)
    setLoading(false)
    if (result.success) {
      setWithdrawn(true)
      toast.success(`Withdrawn submission for ${userRow.userName}`)
      router.refresh()
    } else if (result.error) {
      toast.error(result.error)
    }
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Submitted
      </Badge>
      <button
        onClick={handleWithdraw}
        disabled={loading}
        title="Withdraw submission"
        className="text-amber-500 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default function WeeklyReportSlider({ weeks }: { weeks: WeekData[] }) {
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('day')

  const aggregatedProjects = useMemo(() => buildAggregatedProjects(weeks), [weeks])

  if (weeks.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          No entries found for the selected filters.
        </CardContent>
      </Card>
    )
  }

  const week = weeks[currentWeekIndex]
  const totalHoursAllWeeks = weeks.reduce((s, w) => s + w.weekTotal, 0)

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {viewMode === 'day' && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentWeekIndex === 0}
                onClick={() => setCurrentWeekIndex(i => i - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentWeekIndex === weeks.length - 1}
                onClick={() => setCurrentWeekIndex(i => i + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <h3 className="text-lg font-semibold text-gray-800 ml-1">
                Week {week.weekStartLabel} — {week.weekEndLabel}
              </h3>
              <span className="text-sm text-muted-foreground">
                ({currentWeekIndex + 1} of {weeks.length})
              </span>
              <Badge variant="outline" className="font-mono text-xs ml-1">
                {week.weekTotal}h total
              </Badge>
            </>
          )}
          {viewMode === 'week' && (
            <>
              <h3 className="text-lg font-semibold text-gray-800">
                Summary — {weeks[0].weekStartLabel} to {weeks[weeks.length - 1].weekEndLabel}
              </h3>
              <Badge variant="outline" className="font-mono text-xs ml-1">
                {totalHoursAllWeeks}h total
              </Badge>
            </>
          )}
        </div>

        {/* View toggle */}
        <div className="flex border rounded-md overflow-hidden">
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'day'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setViewMode('day')}
          >
            Day
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
              viewMode === 'week'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'day' ? (
        // Day view: single week with daily columns, navigate with arrows
        week.projects.map(project => (
          <Card key={project.name}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{project.name}</CardTitle>
                {project.code && (
                  <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Code</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Description</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Employee</th>
                      {week.days.map(d => (
                        <th
                          key={d.key}
                          className={`text-center px-2 py-2 font-medium whitespace-nowrap ${d.isWeekend ? 'text-red-400 bg-red-50/50' : 'text-gray-600'}`}
                        >
                          <div className="text-[10px] uppercase">{d.dayName}</div>
                          <div className="text-xs">{d.dateLabel}</div>
                        </th>
                      ))}
                      <th className="text-center px-3 py-2 font-bold text-gray-800 bg-gray-100 w-16">Σ</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {project.subProjects.map(sp =>
                      sp.users.map((userRow, idx) => (
                        <tr key={`${sp.code}-${userRow.userName}`} className="hover:bg-gray-50">
                          {idx === 0 && (
                            <td className="px-3 py-2 font-mono text-xs text-blue-700 font-semibold align-top" rowSpan={sp.users.length}>
                              {sp.code}
                            </td>
                          )}
                          {idx === 0 && (
                            <td className="px-3 py-2 text-xs text-gray-500 align-top" rowSpan={sp.users.length}>
                              {sp.description || '—'}
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
                          {week.days.map(d => {
                            const unit = (userRow.trackingType ?? sp.trackingType) === 'days' ? 'd' : 'h'
                            return (
                              <td key={d.key} className={`px-2 py-2 text-center ${d.isWeekend ? 'bg-red-50/30' : ''}`}>
                                {userRow.dailyHours[d.key]
                                  ? <span className="font-medium text-gray-800">{userRow.dailyHours[d.key]}{unit}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-600 bg-gray-50">{userRow.weekTotal}{(userRow.trackingType ?? sp.trackingType) === 'days' ? 'd' : 'h'}</td>
                          <td className="px-3 py-2 text-center">
                            <StatusCell userRow={userRow} weekStart={week.weekStart} />
                          </td>
                        </tr>
                      ))
                    )}
                    {/* Project subtotal */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-500 uppercase tracking-wide">Project Total</td>
                      {week.days.map(d => {
                        const t = project.dailyTotals[d.key] ?? 0
                        return (
                          <td key={d.key} className="px-2 py-2 text-center text-sm">
                            {t > 0 ? <span className="font-bold">{t}h</span> : <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center text-blue-700 bg-blue-50">
                        {project.weekTotal}h
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        // Week view: one table per project, one column per week
        aggregatedProjects.map(project => (
          <Card key={project.name}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{project.name}</CardTitle>
                {project.code && (
                  <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Code</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Description</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Employee</th>
                      {weeks.map(w => (
                        <th key={w.weekStart} className="text-center px-2 py-2 font-medium text-gray-600 whitespace-nowrap">
                          <div className="text-xs">{w.weekStartLabel}</div>
                          <div className="text-xs">{w.weekEndLabel}</div>
                        </th>
                      ))}
                      <th className="text-center px-3 py-2 font-bold text-gray-800 bg-gray-100 w-16">Σ</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {project.subProjects.map(sp =>
                      sp.users.map((user, idx) => (
                        <tr key={`${sp.code}-${user.userName}`} className="hover:bg-gray-50">
                          {idx === 0 && (
                            <td className="px-3 py-2 font-mono text-xs text-blue-700 font-semibold align-top" rowSpan={sp.users.length}>
                              {sp.code}
                            </td>
                          )}
                          {idx === 0 && (
                            <td className="px-3 py-2 text-xs text-gray-500 align-top" rowSpan={sp.users.length}>
                              {sp.description || '—'}
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {user.userName.charAt(0)}
                              </div>
                              {user.userName}
                            </div>
                          </td>
                          {weeks.map(w => {
                            const h = user.weeklyHours[w.weekStart] ?? 0
                            const wUnit = sp.trackingType === 'days' ? 'd' : 'h'
                            return (
                              <td key={w.weekStart} className="px-2 py-2 text-center">
                                {h > 0
                                  ? <span className="font-medium text-gray-800">{h}{wUnit}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-600 bg-gray-50">{user.total}{sp.trackingType === 'days' ? 'd' : 'h'}</td>
                          <td className="px-3 py-2 text-center">
                            {user.isSubmitted ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Submitted
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                    {/* Project subtotal */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-500 uppercase tracking-wide">Project Total</td>
                      {weeks.map(w => {
                        const t = project.weeklyTotals[w.weekStart] ?? 0
                        return (
                          <td key={w.weekStart} className="px-2 py-2 text-center text-sm">
                            {t > 0 ? <span className="font-bold">{t}h</span> : <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center text-blue-700 bg-blue-50">
                        {project.total}h
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
